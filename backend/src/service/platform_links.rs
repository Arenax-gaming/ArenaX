//! Platform identity, match verification, and telemetry adapters (Issue #1264).
//!
//! Steam, Xbox, and PlayStation profiles are parsed from their public payload
//! shapes and linked to an ArenaX player. A reported result is accepted only
//! when every player is linked and the platform roster carries the same score.
//! Each supported game maps its own telemetry fields onto the shared analysis
//! frame.

use crate::api_error::ApiError;
use crate::auth::jwt_service::JwtService;
use crate::http::auth_handler::ACCESS_TOKEN_COOKIE;
use crate::service::gameplay_analysis::{GameplayAnalysis, TelemetryFrame};
use actix_web::{web, HttpRequest, HttpResponse};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Steam,
    Xbox,
    PlayStation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PlatformError {
    Invalid(String),
    Conflict(String),
    Unlinked(Uuid),
    Roster(String),
    Score {
        external_id: String,
        reported: i64,
        platform: i64,
    },
}

impl std::fmt::Display for PlatformError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlatformError::Invalid(reason) => write!(f, "{reason}"),
            PlatformError::Conflict(reason) => write!(f, "{reason}"),
            PlatformError::Unlinked(user_id) => {
                write!(f, "Player {user_id} is not linked on this platform")
            }
            PlatformError::Roster(external_id) => {
                write!(f, "Platform match has no player {external_id}")
            }
            PlatformError::Score {
                external_id,
                reported,
                platform,
            } => write!(
                f,
                "Score for {external_id} is {reported} on ArenaX and {platform} on the platform"
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkedIdentity {
    pub user_id: Uuid,
    pub platform: Platform,
    pub external_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterEntry {
    pub external_id: String,
    pub score: i64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ReportedScore {
    pub user_id: Uuid,
    pub score: i64,
}

pub struct PlatformLinks {
    links: Mutex<Vec<LinkedIdentity>>,
}

impl PlatformLinks {
    pub fn new() -> Self {
        Self {
            links: Mutex::new(Vec::new()),
        }
    }

    pub async fn link(&self, identity: LinkedIdentity) -> Result<LinkedIdentity, PlatformError> {
        if identity.external_id.trim().is_empty() || identity.display_name.trim().is_empty() {
            return Err(PlatformError::Invalid(
                "Platform id and display name are required".into(),
            ));
        }
        let mut links = self.links.lock().await;
        if let Some(existing) = links.iter().find(|row| {
            row.platform == identity.platform
                && row.external_id == identity.external_id
                && row.user_id != identity.user_id
        }) {
            return Err(PlatformError::Conflict(format!(
                "Platform account {} is already linked to {}",
                existing.external_id, existing.user_id
            )));
        }
        if let Some(row) = links
            .iter_mut()
            .find(|row| row.user_id == identity.user_id && row.platform == identity.platform)
        {
            row.external_id = identity.external_id.clone();
            row.display_name = identity.display_name.clone();
            return Ok(row.clone());
        }
        links.push(identity.clone());
        Ok(identity)
    }

    pub async fn links_for(&self, user_id: Uuid) -> Vec<LinkedIdentity> {
        self.links
            .lock()
            .await
            .iter()
            .filter(|row| row.user_id == user_id)
            .cloned()
            .collect()
    }

    pub async fn verify(
        &self,
        platform: Platform,
        roster: &[RosterEntry],
        reported: &[ReportedScore],
    ) -> Result<(), PlatformError> {
        let links = self.links.lock().await.clone();
        verify_match(&links, platform, roster, reported)
    }
}

impl Default for PlatformLinks {
    fn default() -> Self {
        Self::new()
    }
}

pub fn parse_platform(value: &str) -> Result<Platform, PlatformError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "steam" => Ok(Platform::Steam),
        "xbox" => Ok(Platform::Xbox),
        "playstation" | "psn" | "ps5" => Ok(Platform::PlayStation),
        _ => Err(PlatformError::Invalid(
            "Platform must be steam, xbox, or playstation".into(),
        )),
    }
}

pub fn parse_steam_summary(payload: &Value) -> Result<(String, String), PlatformError> {
    let player = payload
        .pointer("/response/players/0")
        .ok_or_else(|| PlatformError::Invalid("Steam summary has no player".into()))?;
    pair(player, "steamid", "personaname", "Steam")
}

pub fn parse_xbox_profile(payload: &Value) -> Result<(String, String), PlatformError> {
    let profile = payload
        .pointer("/profileUsers/0")
        .ok_or_else(|| PlatformError::Invalid("Xbox profile has no user".into()))?;
    let external_id = profile
        .get("id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PlatformError::Invalid("Xbox profile is missing id".into()))?
        .to_string();
    let display_name = profile
        .get("settings")
        .and_then(|value| value.as_array())
        .and_then(|settings| {
            settings.iter().find_map(|setting| {
                let id = setting.get("id").and_then(|value| value.as_str())?;
                if id == "Gamertag" {
                    setting
                        .get("value")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                } else {
                    None
                }
            })
        })
        .filter(|value| !value.is_empty())
        .ok_or_else(|| PlatformError::Invalid("Xbox profile is missing Gamertag".into()))?;
    Ok((external_id, display_name))
}

pub fn parse_playstation_profile(payload: &Value) -> Result<(String, String), PlatformError> {
    pair(payload, "accountId", "onlineId", "PlayStation")
}

fn pair(
    value: &Value,
    id_key: &str,
    name_key: &str,
    label: &str,
) -> Result<(String, String), PlatformError> {
    let external_id = value
        .get(id_key)
        .and_then(|item| item.as_str())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| PlatformError::Invalid(format!("{label} profile is missing {id_key}")))?;
    let display_name = value
        .get(name_key)
        .and_then(|item| item.as_str())
        .filter(|item| !item.is_empty())
        .ok_or_else(|| PlatformError::Invalid(format!("{label} profile is missing {name_key}")))?;
    Ok((external_id.to_string(), display_name.to_string()))
}

pub fn verify_match(
    links: &[LinkedIdentity],
    platform: Platform,
    roster: &[RosterEntry],
    reported: &[ReportedScore],
) -> Result<(), PlatformError> {
    if reported.is_empty() {
        return Err(PlatformError::Invalid(
            "A match needs at least one reported score".into(),
        ));
    }
    if roster.is_empty() {
        return Err(PlatformError::Invalid("Platform roster is empty".into()));
    }
    for score in reported {
        let identity = links
            .iter()
            .find(|row| row.user_id == score.user_id && row.platform == platform)
            .ok_or(PlatformError::Unlinked(score.user_id))?;
        let entry = roster
            .iter()
            .find(|row| row.external_id == identity.external_id)
            .ok_or_else(|| PlatformError::Roster(identity.external_id.clone()))?;
        if entry.score != score.score {
            return Err(PlatformError::Score {
                external_id: identity.external_id.clone(),
                reported: score.score,
                platform: entry.score,
            });
        }
    }
    Ok(())
}

/// Map a game's telemetry payload onto the shared analysis frame.
pub fn adapt_telemetry(game: &str, raw: &Value) -> Result<TelemetryFrame, PlatformError> {
    match game.trim().to_ascii_lowercase().as_str() {
        "fps" => frame_from(
            raw,
            "reaction_ms",
            "accuracy_bps",
            "snap_deg_per_sec",
            "speed_milli",
            "speed_limit_milli",
            "entropy_bps",
        ),
        "sports" => frame_from(
            raw,
            "input_delay_ms",
            "shot_accuracy_bps",
            "turn_rate",
            "sprint_speed_milli",
            "max_sprint_milli",
            "input_variety_bps",
        ),
        "racing" => frame_from(
            raw,
            "reaction_ms",
            "racing_line_bps",
            "steering_rate",
            "speed_milli",
            "track_limit_milli",
            "input_entropy_bps",
        ),
        _ => Err(PlatformError::Invalid(
            "Game must be fps, sports, or racing".into(),
        )),
    }
}

fn frame_from(
    raw: &Value,
    reaction: &str,
    accuracy: &str,
    snap: &str,
    speed: &str,
    limit: &str,
    entropy: &str,
) -> Result<TelemetryFrame, PlatformError> {
    Ok(TelemetryFrame {
        match_id: uuid_field(raw, "match_id")?,
        player_id: uuid_field(raw, "player_id")?,
        seq: u64_field(raw, "seq")?,
        reaction_ms: u32_field(raw, reaction)?,
        accuracy_bps: u32_field(raw, accuracy)?,
        snap_deg_per_sec: u32_field(raw, snap)?,
        speed_milli: u32_field(raw, speed)?,
        speed_limit_milli: u32_field(raw, limit)?,
        entropy_bps: u32_field(raw, entropy)?,
    })
}

fn uuid_field(raw: &Value, key: &str) -> Result<Uuid, PlatformError> {
    let text = raw
        .get(key)
        .and_then(|value| value.as_str())
        .ok_or_else(|| PlatformError::Invalid(format!("{key} is required")))?;
    Uuid::parse_str(text).map_err(|_| PlatformError::Invalid(format!("{key} is not a uuid")))
}

fn u64_field(raw: &Value, key: &str) -> Result<u64, PlatformError> {
    raw.get(key)
        .and_then(|value| value.as_u64())
        .ok_or_else(|| PlatformError::Invalid(format!("{key} must be a non-negative integer")))
}

fn u32_field(raw: &Value, key: &str) -> Result<u32, PlatformError> {
    let value = u64_field(raw, key)?;
    u32::try_from(value).map_err(|_| PlatformError::Invalid(format!("{key} is out of range")))
}

fn map_error(error: PlatformError) -> ApiError {
    match error {
        PlatformError::Conflict(message) => ApiError::conflict(message),
        other => ApiError::bad_request(other.to_string()),
    }
}

#[derive(Debug, Deserialize)]
struct LinkBody {
    user_id: Uuid,
    platform: String,
    profile: Value,
}

#[derive(Debug, Deserialize)]
struct VerifyBody {
    platform: String,
    roster: Vec<RosterBody>,
    reported: Vec<ReportedScore>,
}

#[derive(Debug, Deserialize)]
struct RosterBody {
    external_id: String,
    score: i64,
}

#[derive(Debug, Deserialize)]
struct TelemetryBody {
    game: String,
    telemetry: Value,
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

async fn link_identity(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    links: web::Data<Arc<PlatformLinks>>,
    body: web::Json<LinkBody>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let is_admin = claims.roles.iter().any(|role| role == "admin");
    if claims.sub != body.user_id.to_string() && !is_admin {
        return Err(ApiError::forbidden("You can only link your own account"));
    }
    let platform = parse_platform(&body.platform).map_err(map_error)?;
    let (external_id, display_name) = match platform {
        Platform::Steam => parse_steam_summary(&body.profile),
        Platform::Xbox => parse_xbox_profile(&body.profile),
        Platform::PlayStation => parse_playstation_profile(&body.profile),
    }
    .map_err(map_error)?;
    let linked = links
        .link(LinkedIdentity {
            user_id: body.user_id,
            platform,
            external_id,
            display_name,
        })
        .await
        .map_err(map_error)?;
    Ok(HttpResponse::Ok().json(linked))
}

async fn verify_result(
    links: web::Data<Arc<PlatformLinks>>,
    body: web::Json<VerifyBody>,
) -> Result<HttpResponse, ApiError> {
    let platform = parse_platform(&body.platform).map_err(map_error)?;
    let roster: Vec<RosterEntry> = body
        .roster
        .iter()
        .map(|row| RosterEntry {
            external_id: row.external_id.clone(),
            score: row.score,
        })
        .collect();
    links
        .verify(platform, &roster, &body.reported)
        .await
        .map_err(map_error)?;
    Ok(HttpResponse::Ok().json(serde_json::json!({ "verified": true })))
}

async fn adapt_and_ingest(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    analysis: web::Data<Arc<GameplayAnalysis>>,
    body: web::Json<TelemetryBody>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let frame = adapt_telemetry(&body.game, &body.telemetry).map_err(map_error)?;
    let is_admin = claims.roles.iter().any(|role| role == "admin");
    if claims.sub != frame.player_id.to_string() && !is_admin {
        return Err(ApiError::forbidden(
            "You can only stream your own telemetry",
        ));
    }
    let result = analysis
        .ingest(frame)
        .await
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    Ok(HttpResponse::Ok().json(result))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/platforms")
            .route("/link", web::post().to(link_identity))
            .route("/verify", web::post().to(verify_result))
            .route("/telemetry", web::post().to(adapt_and_ingest)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(user: u128, platform: Platform, external_id: &str) -> LinkedIdentity {
        LinkedIdentity {
            user_id: Uuid::from_u128(user),
            platform,
            external_id: external_id.into(),
            display_name: external_id.into(),
        }
    }

    #[test]
    fn profile_parsers_read_each_platform_shape() {
        let steam = serde_json::json!({"response": {"players": [{"steamid": "765", "personaname": "Ada"}]}});
        assert_eq!(
            parse_steam_summary(&steam).unwrap(),
            ("765".into(), "Ada".into())
        );

        let xbox = serde_json::json!({"profileUsers": [{"id": "xuid-1", "settings": [{"id": "Gamertag", "value": "Bob"}]}]});
        assert_eq!(
            parse_xbox_profile(&xbox).unwrap(),
            ("xuid-1".into(), "Bob".into())
        );

        let playstation = serde_json::json!({"accountId": "psn-1", "onlineId": "Cy"});
        assert_eq!(
            parse_playstation_profile(&playstation).unwrap(),
            ("psn-1".into(), "Cy".into())
        );
        assert!(parse_steam_summary(&serde_json::json!({})).is_err());
    }

    #[test]
    fn verification_requires_links_roster_and_matching_scores() {
        let links = vec![
            identity(1, Platform::Steam, "765"),
            identity(2, Platform::Steam, "766"),
            identity(1, Platform::Xbox, "xuid-1"),
        ];
        let roster = vec![
            RosterEntry {
                external_id: "765".into(),
                score: 10,
            },
            RosterEntry {
                external_id: "766".into(),
                score: 7,
            },
        ];
        let reported = vec![
            ReportedScore {
                user_id: Uuid::from_u128(1),
                score: 10,
            },
            ReportedScore {
                user_id: Uuid::from_u128(2),
                score: 7,
            },
        ];
        assert!(verify_match(&links, Platform::Steam, &roster, &reported).is_ok());

        let mut wrong = reported.clone();
        wrong[0].score = 11;
        assert!(matches!(
            verify_match(&links, Platform::Steam, &roster, &wrong),
            Err(PlatformError::Score { .. })
        ));
        assert!(matches!(
            verify_match(&links, Platform::Xbox, &roster, &reported),
            Err(PlatformError::Unlinked(_))
        ));
    }

    #[tokio::test]
    async fn one_platform_account_cannot_belong_to_two_players() {
        let links = PlatformLinks::new();
        links
            .link(identity(1, Platform::PlayStation, "psn-1"))
            .await
            .unwrap();
        let err = links
            .link(identity(2, Platform::PlayStation, "psn-1"))
            .await;
        assert!(matches!(err, Err(PlatformError::Conflict(_))));
        let updated = links
            .link(identity(1, Platform::PlayStation, "psn-2"))
            .await
            .unwrap();
        assert_eq!(updated.external_id, "psn-2");
    }

    #[test]
    fn game_adapters_share_one_analysis_frame() {
        let match_id = Uuid::from_u128(7);
        let player_id = Uuid::from_u128(8);
        let sports = serde_json::json!({
            "match_id": match_id.to_string(),
            "player_id": player_id.to_string(),
            "seq": 3,
            "input_delay_ms": 40,
            "shot_accuracy_bps": 9900,
            "turn_rate": 1600,
            "sprint_speed_milli": 2000,
            "max_sprint_milli": 1000,
            "input_variety_bps": 100
        });
        let frame = adapt_telemetry("sports", &sports).unwrap();
        assert_eq!(frame.reaction_ms, 40);
        assert_eq!(frame.speed_limit_milli, 1000);
        assert!(
            crate::service::gameplay_analysis::infer(&frame)
                .unwrap()
                .score
                >= 70
        );

        let racing = serde_json::json!({
            "match_id": match_id.to_string(),
            "player_id": player_id.to_string(),
            "seq": 1,
            "reaction_ms": 200,
            "racing_line_bps": 5000,
            "steering_rate": 30,
            "speed_milli": 400,
            "track_limit_milli": 900,
            "input_entropy_bps": 8000
        });
        assert!(adapt_telemetry("racing", &racing).is_ok());
        assert!(adapt_telemetry("chess", &racing).is_err());
    }
}
