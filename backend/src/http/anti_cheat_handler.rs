use actix_web::{web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct TelemetryAnalysisRequest {
    pub player_id: String,
    pub match_id: String,
    pub reaction_time_ms: f64,
    pub aim_snap_rate: f64,
    pub input_variance: f64,
}

#[derive(Debug, Serialize)]
pub struct TelemetryAnalysisResponse {
    pub is_anomalous: bool,
    pub anomaly_score: f64,
    pub flagged_reasons: Vec<String>,
}

/// AI Anti-cheat telemetry analysis pipeline (Issue #1250)
pub async fn analyze_telemetry(
    req: web::Json<TelemetryAnalysisRequest>,
) -> impl Responder {
    let mut flagged_reasons = Vec::new();
    let mut anomaly_score = 0.0;

    if req.reaction_time_ms < 50.0 {
        flagged_reasons.push("Superhuman reaction time (<50ms)".to_string());
        anomaly_score += 0.4;
    }

    if req.aim_snap_rate > 0.85 {
        flagged_reasons.push("Abnormal aim snap rate (>85%)".to_string());
        anomaly_score += 0.4;
    }

    if req.input_variance < 0.01 {
        flagged_reasons.push("Zero input variance (scripted bot movement)".to_string());
        anomaly_score += 0.3;
    }

    let is_anomalous = anomaly_score >= 0.5;

    HttpResponse::Ok().json(TelemetryAnalysisResponse {
        is_anomalous,
        anomaly_score,
        flagged_reasons,
    })
}
