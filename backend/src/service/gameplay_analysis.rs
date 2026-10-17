//! Real-time gameplay analysis (Issue #1260).
//!
//! Telemetry frames for a match are accepted in order, scored by a bounded
//! inference step, and raised on that match's monitoring channel when the
//! suspicion score crosses the alert threshold.

use crate::api_error::ApiError;
use crate::auth::jwt_service::JwtService;
use crate::http::auth_handler::ACCESS_TOKEN_COOKIE;
use crate::realtime::event_bus::EventBus;
use crate::realtime::events::RealtimeEvent;
use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

pub const ALERT_THRESHOLD: u8 = 70;
pub const LATENCY_BUDGET: Duration = Duration::from_millis(10);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnalysisError {
    Invalid(String),
    Replay,
    Slow(Duration),
}

impl std::fmt::Display for AnalysisError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AnalysisError::Invalid(reason) => write!(f, "{reason}"),
            AnalysisError::Replay => write!(f, "Telemetry sequence is older than the last frame"),
            AnalysisError::Slow(latency) => {
                write!(
                    f,
                    "Inference took {}µs, over the latency budget",
                    latency.as_micros()
                )
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TelemetryFrame {
    pub match_id: Uuid,
    pub player_id: Uuid,
    pub seq: u64,
    pub reaction_ms: u32,
    pub accuracy_bps: u32,
    pub snap_deg_per_sec: u32,
    pub speed_milli: u32,
    pub speed_limit_milli: u32,
    pub entropy_bps: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Inference {
    pub score: u8,
    pub latency: Duration,
    pub reasons: Vec<&'static str>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Alert {
    pub id: Uuid,
    pub match_id: Uuid,
    pub player_id: Uuid,
    pub seq: u64,
    pub score: u8,
    pub reasons: Vec<String>,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MatchMonitor {
    pub match_id: Uuid,
    pub samples: u64,
    pub alerts: Vec<Alert>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct IngestResult {
    pub score: u8,
    pub alert: bool,
    pub reasons: Vec<String>,
    pub latency_us: u128,
}

struct WatchState {
    last_seq: HashMap<(Uuid, Uuid), u64>,
    samples: HashMap<Uuid, u64>,
    alerts: HashMap<Uuid, Vec<Alert>>,
}

pub struct GameplayAnalysis {
    state: AsyncMutex<WatchState>,
    bus: Option<EventBus>,
    published: Mutex<Vec<Alert>>,
}

impl GameplayAnalysis {
    pub fn new(bus: Option<EventBus>) -> Self {
        Self {
            state: AsyncMutex::new(WatchState {
                last_seq: HashMap::new(),
                samples: HashMap::new(),
                alerts: HashMap::new(),
            }),
            bus,
            published: Mutex::new(Vec::new()),
        }
    }

    pub fn published(&self) -> Vec<Alert> {
        self.published.lock().expect("analysis outbox").clone()
    }

    pub async fn ingest(&self, frame: TelemetryFrame) -> Result<IngestResult, AnalysisError> {
        let mut state = self.state.lock().await;
        let key = (frame.match_id, frame.player_id);
        if let Some(last) = state.last_seq.get(&key) {
            if frame.seq <= *last {
                return Err(AnalysisError::Replay);
            }
        }
        let inference = infer(&frame)?;
        state.last_seq.insert(key, frame.seq);
        *state.samples.entry(frame.match_id).or_insert(0) += 1;
        let reasons: Vec<String> = inference
            .reasons
            .iter()
            .map(|reason| (*reason).to_string())
            .collect();
        let alert = inference.score >= ALERT_THRESHOLD;
        if alert {
            let record = Alert {
                id: Uuid::new_v4(),
                match_id: frame.match_id,
                player_id: frame.player_id,
                seq: frame.seq,
                score: inference.score,
                reasons: reasons.clone(),
                at: Utc::now().to_rfc3339(),
            };
            self.published
                .lock()
                .expect("analysis outbox")
                .push(record.clone());
            state
                .alerts
                .entry(frame.match_id)
                .or_default()
                .push(record.clone());
            drop(state);
            self.publish_alert(&record).await;
        }
        Ok(IngestResult {
            score: inference.score,
            alert,
            reasons,
            latency_us: inference.latency.as_micros(),
        })
    }

    pub async fn monitor(&self, match_id: Uuid) -> MatchMonitor {
        let state = self.state.lock().await;
        MatchMonitor {
            match_id,
            samples: state.samples.get(&match_id).copied().unwrap_or(0),
            alerts: state.alerts.get(&match_id).cloned().unwrap_or_default(),
        }
    }

    async fn publish_alert(&self, alert: &Alert) {
        let Some(bus) = &self.bus else {
            return;
        };
        bus.publish_to_match(
            alert.match_id,
            &RealtimeEvent::Notification {
                id: alert.id,
                title: "Suspicious gameplay".into(),
                body: format!("score {}: {}", alert.score, alert.reasons.join(", ")),
                category: "anticheat".into(),
                timestamp: alert.at.clone(),
            },
        )
        .await;
    }
}

pub fn validate(frame: &TelemetryFrame) -> Result<(), AnalysisError> {
    if frame.accuracy_bps > 10_000 {
        return Err(AnalysisError::Invalid(
            "accuracy_bps must be 0-10000".into(),
        ));
    }
    if frame.entropy_bps > 10_000 {
        return Err(AnalysisError::Invalid("entropy_bps must be 0-10000".into()));
    }
    if frame.speed_limit_milli == 0 {
        return Err(AnalysisError::Invalid(
            "speed_limit_milli must be positive".into(),
        ));
    }
    Ok(())
}

/// Score one frame. The work is bounded by [`LATENCY_BUDGET`].
pub fn infer(frame: &TelemetryFrame) -> Result<Inference, AnalysisError> {
    let started = Instant::now();
    validate(frame)?;
    let mut score: u32 = 0;
    let mut reasons = Vec::new();
    if frame.reaction_ms < 50 {
        score += 50;
        reasons.push("reaction below human floor");
    } else if frame.reaction_ms < 90 {
        score += 30;
        reasons.push("reaction faster than expected");
    }
    if frame.accuracy_bps > 9_500 {
        score += 25;
        reasons.push("accuracy above 95%");
    } else if frame.accuracy_bps > 8_500 {
        score += 15;
        reasons.push("accuracy above 85%");
    }
    if frame.snap_deg_per_sec > 1_440 {
        score += 35;
        reasons.push("snap faster than 1440 deg/s");
    } else if frame.snap_deg_per_sec > 720 {
        score += 20;
        reasons.push("snap faster than 720 deg/s");
    }
    if frame.speed_milli > frame.speed_limit_milli {
        score += 40;
        reasons.push("speed above the game limit");
    }
    if frame.entropy_bps < 500 {
        score += 15;
        reasons.push("input entropy looks scripted");
    }
    let latency = started.elapsed();
    if latency > LATENCY_BUDGET {
        return Err(AnalysisError::Slow(latency));
    }
    Ok(Inference {
        score: score.min(100) as u8,
        latency,
        reasons,
    })
}

fn map_error(error: AnalysisError) -> ApiError {
    match error {
        AnalysisError::Slow(_) => ApiError::ServiceUnavailable(error.to_string()),
        other => ApiError::bad_request(other.to_string()),
    }
}

async fn caller(
    req: &HttpRequest,
    jwt: &JwtService,
) -> Result<crate::auth::jwt_service::Claims, ApiError> {
    let token = req
        .headers()
        .get("Authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::to_owned)
        .or_else(|| {
            req.cookie(ACCESS_TOKEN_COOKIE)
                .map(|cookie| cookie.value().to_string())
        })
        .ok_or_else(|| ApiError::unauthorized("Authentication required"))?;
    jwt.validate_token(&token)
        .await
        .map_err(|_| ApiError::unauthorized("Authentication required"))
}

async fn post_telemetry(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    analysis: web::Data<Arc<GameplayAnalysis>>,
    body: web::Json<TelemetryFrame>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let is_admin = claims.roles.iter().any(|role| role == "admin");
    if claims.sub != body.player_id.to_string() && !is_admin {
        return Err(ApiError::forbidden(
            "You can only stream your own telemetry",
        ));
    }
    let result = analysis
        .ingest(body.into_inner())
        .await
        .map_err(map_error)?;
    Ok(HttpResponse::Ok().json(result))
}

async fn get_monitor(
    analysis: web::Data<Arc<GameplayAnalysis>>,
    match_id: web::Path<Uuid>,
) -> Result<HttpResponse, ApiError> {
    Ok(HttpResponse::Ok().json(analysis.monitor(match_id.into_inner()).await))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/analysis")
            .route("/telemetry", web::post().to(post_telemetry))
            .route("/matches/{match_id}", web::get().to(get_monitor)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(seq: u64, reaction_ms: u32, speed_milli: u32) -> TelemetryFrame {
        TelemetryFrame {
            match_id: Uuid::from_u128(1),
            player_id: Uuid::from_u128(2),
            seq,
            reaction_ms,
            accuracy_bps: 4_000,
            snap_deg_per_sec: 90,
            speed_milli,
            speed_limit_milli: 1_000,
            entropy_bps: 7_000,
        }
    }

    #[test]
    fn ordinary_play_stays_under_the_alert_line_and_the_budget() {
        let inference = infer(&frame(1, 180, 500)).unwrap();
        assert!(inference.score < ALERT_THRESHOLD);
        assert!(inference.reasons.is_empty());
        assert!(inference.latency <= LATENCY_BUDGET);
    }

    #[test]
    fn impossible_speed_and_inhuman_reaction_alert() {
        let mut sample = frame(1, 20, 5_000);
        sample.accuracy_bps = 9_900;
        let inference = infer(&sample).unwrap();
        assert!(inference.score >= ALERT_THRESHOLD);
        assert!(inference
            .reasons
            .iter()
            .any(|reason| reason.contains("speed")));
        assert!(inference
            .reasons
            .iter()
            .any(|reason| reason.contains("human")));
    }

    #[test]
    fn out_of_range_accuracy_is_rejected() {
        let mut sample = frame(1, 180, 500);
        sample.accuracy_bps = 10_001;
        assert!(infer(&sample).is_err());
    }

    #[tokio::test]
    async fn frames_stream_in_order_and_alerts_attach_to_the_match() {
        let analysis = GameplayAnalysis::new(None);
        let calm = analysis.ingest(frame(1, 180, 500)).await.unwrap();
        assert!(!calm.alert);

        let mut suspicious = frame(2, 20, 5_000);
        suspicious.entropy_bps = 100;
        let flagged = analysis.ingest(suspicious).await.unwrap();
        assert!(flagged.alert);

        assert!(matches!(
            analysis.ingest(frame(2, 180, 500)).await,
            Err(AnalysisError::Replay)
        ));

        let monitor = analysis.monitor(Uuid::from_u128(1)).await;
        assert_eq!(monitor.samples, 2);
        assert_eq!(monitor.alerts.len(), 1);
        assert_eq!(monitor.alerts[0].player_id, Uuid::from_u128(2));
        assert_eq!(analysis.published().len(), 1);

        let other = analysis.monitor(Uuid::from_u128(99)).await;
        assert_eq!(other.samples, 0);
        assert!(other.alerts.is_empty());
    }
}
