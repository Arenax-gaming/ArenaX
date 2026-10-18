//! Community leaderboard with Stellar Reputation Token balances (Issue #1257).
//!
//! Players are ranked inside a community, and optionally inside one tournament.
//! The reputation column is the on-chain `REP` balance read from Horizon, not a
//! locally invented score. A balance change bumps a monotonic version and is
//! published on `community:{id}` so connected clients can replace the board.

use crate::api_error::ApiError;
use crate::auth::jwt_service::JwtService;
use crate::http::auth_handler::ACCESS_TOKEN_COOKIE;
use crate::realtime::event_bus::EventBus;
use crate::realtime::events::channels;
use crate::realtime::events::{CommunityRankEntry, RealtimeEvent};
use crate::service::stellar_service::{stellar_strkey_decode, stellar_strkey_encode};
use actix_web::{web, HttpRequest, HttpResponse};
use chrono::Utc;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

const STORE_KEY: &str = "community:leaderboard:members";
const MEMBER_CAP: usize = 5_000;
const PUBLIC_KEY_VERSION: u8 = 6 << 3;
const STROOPS: i64 = 10_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeaderboardError {
    Invalid(String),
    NotFound,
    Conflict(String),
    NotConfigured,
    Horizon(String),
    Store(String),
}

impl std::fmt::Display for LeaderboardError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LeaderboardError::Invalid(reason) => write!(f, "{reason}"),
            LeaderboardError::NotFound => write!(f, "Player is not on this leaderboard"),
            LeaderboardError::Conflict(reason) => write!(f, "{reason}"),
            LeaderboardError::NotConfigured => {
                write!(f, "STELLAR_REPUTATION_ISSUER is not configured")
            }
            LeaderboardError::Horizon(reason) => write!(f, "{reason}"),
            LeaderboardError::Store(reason) => write!(f, "{reason}"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Member {
    user_id: Uuid,
    username: String,
    community_id: String,
    tournament_id: Option<String>,
    public_key: String,
    reputation_stroops: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct BoardState {
    version: u64,
    members: Vec<Member>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RankedPlayer {
    pub rank: i32,
    pub user_id: Uuid,
    pub username: String,
    pub reputation: String,
    pub reputation_stroops: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BoardView {
    pub community_id: String,
    pub tournament_id: Option<String>,
    pub version: u64,
    pub entries: Vec<RankedPlayer>,
}

pub struct CommunityLeaderboard {
    state: AsyncMutex<BoardState>,
    redis: Option<ConnectionManager>,
    bus: Option<EventBus>,
    http: reqwest::Client,
    horizon_url: String,
    asset_code: String,
    issuer: String,
    published: Mutex<Vec<RealtimeEvent>>,
}

impl CommunityLeaderboard {
    pub fn memory(
        horizon_url: impl Into<String>,
        asset_code: impl Into<String>,
        issuer: impl Into<String>,
    ) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            state: AsyncMutex::new(BoardState::default()),
            redis: None,
            bus: None,
            http,
            horizon_url: horizon_url.into().trim_end_matches('/').to_string(),
            asset_code: asset_code.into(),
            issuer: issuer.into(),
            published: Mutex::new(Vec::new()),
        }
    }

    pub async fn open(
        redis: ConnectionManager,
        bus: Option<EventBus>,
        horizon_url: impl Into<String>,
        asset_code: impl Into<String>,
        issuer: impl Into<String>,
    ) -> Self {
        let mut service = Self::memory(horizon_url, asset_code, issuer);
        service.bus = bus;
        let mut conn = redis.clone();
        match conn.get::<_, Option<String>>(STORE_KEY).await {
            Ok(Some(raw)) => match serde_json::from_str::<BoardState>(&raw) {
                Ok(state) => *service.state.lock().await = state,
                Err(error) => {
                    tracing::warn!(%error, "ignoring unreadable community leaderboard snapshot")
                }
            },
            Ok(None) => {}
            Err(error) => tracing::warn!(%error, "community leaderboard snapshot was not loaded"),
        }
        service.redis = Some(redis);
        service
    }

    pub fn published(&self) -> Vec<RealtimeEvent> {
        self.published.lock().expect("leaderboard outbox").clone()
    }

    pub async fn register(&self, member: NewMember) -> Result<BoardView, LeaderboardError> {
        let member = member.validated()?;
        let mut state = self.state.lock().await;
        if let Some(existing) = state
            .members
            .iter()
            .find(|row| row.public_key == member.public_key)
        {
            if existing.user_id != member.user_id {
                return Err(LeaderboardError::Conflict(
                    "That Stellar account is already linked to another player".into(),
                ));
            }
        }
        let is_new = !state
            .members
            .iter()
            .any(|row| row.user_id == member.user_id);
        if is_new && state.members.len() >= MEMBER_CAP {
            return Err(LeaderboardError::Invalid(
                "Community leaderboard is full".into(),
            ));
        }

        let previous = state.clone();
        if let Some(row) = state
            .members
            .iter_mut()
            .find(|row| row.user_id == member.user_id)
        {
            row.username = member.username;
            row.community_id = member.community_id;
            row.tournament_id = member.tournament_id;
            row.public_key = member.public_key;
        } else {
            state.members.push(Member {
                user_id: member.user_id,
                username: member.username,
                community_id: member.community_id,
                tournament_id: member.tournament_id,
                public_key: member.public_key,
                reputation_stroops: 0,
            });
        }
        let community_id = state
            .members
            .iter()
            .find(|row| row.user_id == member.user_id)
            .map(|row| row.community_id.clone())
            .unwrap_or_default();
        let tournament_id = state
            .members
            .iter()
            .find(|row| row.user_id == member.user_id)
            .and_then(|row| row.tournament_id.clone());
        if let Err(error) = self.persist(&state).await {
            *state = previous;
            return Err(error);
        }
        let view = rank(&state, &community_id, tournament_id.as_deref());
        drop(state);
        Ok(view)
    }

    /// Replace the player's reputation with the balance Horizon reports for the
    /// configured reputation asset, then publish the new rankings.
    pub async fn sync_public_key(&self, public_key: &str) -> Result<BoardView, LeaderboardError> {
        let public_key = normalize_public_key(public_key)?;
        if self.issuer.is_empty() {
            return Err(LeaderboardError::NotConfigured);
        }
        let account = fetch_horizon_account(&self.http, &self.horizon_url, &public_key).await?;
        let stroops = reputation_stroops(&account, &self.asset_code, &self.issuer)?;
        self.apply_balance(&public_key, stroops).await
    }

    pub async fn apply_balance(
        &self,
        public_key: &str,
        stroops: i64,
    ) -> Result<BoardView, LeaderboardError> {
        if stroops < 0 {
            return Err(LeaderboardError::Invalid(
                "Reputation balance cannot be negative".into(),
            ));
        }
        let public_key = normalize_public_key(public_key)?;
        let mut state = self.state.lock().await;
        let (community_id, tournament_id) = {
            let Some(row) = state
                .members
                .iter()
                .find(|row| row.public_key == public_key)
            else {
                return Err(LeaderboardError::NotFound);
            };
            (row.community_id.clone(), row.tournament_id.clone())
        };
        let previous = state.clone();
        let row = state
            .members
            .iter_mut()
            .find(|row| row.public_key == public_key)
            .expect("member checked above");
        row.reputation_stroops = stroops;
        state.version = state.version.saturating_add(1);
        let version = state.version;
        if let Err(error) = self.persist(&state).await {
            *state = previous;
            return Err(error);
        }
        let community_view = rank(&state, &community_id, None);
        let tournament_view = tournament_id
            .as_deref()
            .map(|tournament| rank(&state, &community_id, Some(tournament)));
        drop(state);
        self.publish(community_view.clone(), version).await;
        if let Some(view) = tournament_view {
            self.publish(view, version).await;
        }
        Ok(community_view)
    }

    pub async fn board(
        &self,
        community_id: &str,
        tournament_id: Option<&str>,
    ) -> Result<BoardView, LeaderboardError> {
        let community_id = normalize_slug(community_id)?;
        let tournament_id = match tournament_id {
            Some(value) if !value.trim().is_empty() => Some(normalize_slug(value)?),
            _ => None,
        };
        let state = self.state.lock().await;
        Ok(rank(&state, &community_id, tournament_id.as_deref()))
    }

    async fn persist(&self, state: &BoardState) -> Result<(), LeaderboardError> {
        let Some(redis) = &self.redis else {
            return Ok(());
        };
        let payload = serde_json::to_string(state)
            .map_err(|error| LeaderboardError::Store(error.to_string()))?;
        let mut conn = redis.clone();
        conn.set::<_, _, ()>(STORE_KEY, payload)
            .await
            .map_err(|error| LeaderboardError::Store(error.to_string()))
    }

    async fn publish(&self, view: BoardView, version: u64) {
        let event = RealtimeEvent::CommunityLeaderboard {
            community_id: view.community_id.clone(),
            tournament_id: view.tournament_id.clone(),
            version,
            entries: view
                .entries
                .iter()
                .map(|entry| CommunityRankEntry {
                    rank: entry.rank,
                    user_id: entry.user_id,
                    username: entry.username.clone(),
                    reputation: entry.reputation.clone(),
                    reputation_stroops: entry.reputation_stroops,
                })
                .collect(),
            timestamp: Utc::now().to_rfc3339(),
        };
        self.published
            .lock()
            .expect("leaderboard outbox")
            .push(event.clone());
        if let Some(bus) = &self.bus {
            bus.publish_to_channel(&channels::community_channel(&view.community_id), &event)
                .await;
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewMember {
    pub user_id: Uuid,
    pub username: String,
    pub community_id: String,
    pub tournament_id: Option<String>,
    pub public_key: String,
}

impl NewMember {
    fn validated(self) -> Result<ValidatedMember, LeaderboardError> {
        let username = self.username.trim();
        if !(1..=24).contains(&username.chars().count())
            || !username
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err(LeaderboardError::Invalid(
                "Usernames are 1-24 letters, numbers, or underscores".into(),
            ));
        }
        let tournament_id = match self.tournament_id.as_deref() {
            Some(value) if !value.trim().is_empty() => Some(normalize_slug(value)?),
            _ => None,
        };
        Ok(ValidatedMember {
            user_id: self.user_id,
            username: username.to_string(),
            community_id: normalize_slug(&self.community_id)?,
            tournament_id,
            public_key: normalize_public_key(&self.public_key)?,
        })
    }
}

struct ValidatedMember {
    user_id: Uuid,
    username: String,
    community_id: String,
    tournament_id: Option<String>,
    public_key: String,
}

pub fn normalize_slug(input: &str) -> Result<String, LeaderboardError> {
    let slug = input.trim().to_ascii_lowercase();
    if valid_slug(&slug) {
        Ok(slug)
    } else {
        Err(LeaderboardError::Invalid(
            "Use 1-64 lowercase letters, numbers, '_' or '-'".into(),
        ))
    }
}

pub fn valid_slug(slug: &str) -> bool {
    let mut chars = slug.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_lowercase() || first.is_ascii_digit())
        && slug.len() <= 64
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// `community:{slug}` is a public board. Any authenticated player may subscribe.
pub fn authorize_community_channel(channel: &str) -> Result<(), String> {
    let Some(slug) = channel.strip_prefix("community:") else {
        return Err(format!("Unknown channel prefix: {channel}"));
    };
    if valid_slug(slug) {
        Ok(())
    } else {
        Err("community id is malformed".into())
    }
}

pub fn normalize_public_key(input: &str) -> Result<String, LeaderboardError> {
    let key = input.trim();
    let (version, payload) = stellar_strkey_decode(key)
        .map_err(|_| LeaderboardError::Invalid("Stellar public key is invalid".into()))?;
    if version != PUBLIC_KEY_VERSION || payload.len() != 32 {
        return Err(LeaderboardError::Invalid(
            "Stellar public key is invalid".into(),
        ));
    }
    stellar_strkey_encode(version, &payload)
        .map_err(|_| LeaderboardError::Invalid("Stellar public key is invalid".into()))
}

/// Read the reputation asset balance from a Horizon account payload.
///
/// Balances are decimal strings with up to 7 fractional digits. The result is
/// stroops so ranking never depends on floating point.
pub fn reputation_stroops(
    account: &serde_json::Value,
    asset_code: &str,
    issuer: &str,
) -> Result<i64, LeaderboardError> {
    let balances = account
        .get("balances")
        .and_then(|value| value.as_array())
        .ok_or_else(|| LeaderboardError::Horizon("Horizon account has no balances".into()))?;
    for balance in balances {
        let code = balance.get("asset_code").and_then(|value| value.as_str());
        let asset_issuer = balance.get("asset_issuer").and_then(|value| value.as_str());
        if code == Some(asset_code) && asset_issuer == Some(issuer) {
            let raw = balance
                .get("balance")
                .and_then(|value| value.as_str())
                .ok_or_else(|| LeaderboardError::Horizon("Reputation balance is missing".into()))?;
            return stroops_from_decimal(raw);
        }
    }
    Err(LeaderboardError::Horizon(
        "Account has no reputation-token trustline".into(),
    ))
}

pub fn stroops_from_decimal(raw: &str) -> Result<i64, LeaderboardError> {
    let raw = raw.trim();
    let (negative, raw) = if let Some(rest) = raw.strip_prefix('-') {
        (true, rest)
    } else {
        (false, raw.strip_prefix('+').unwrap_or(raw))
    };
    if raw.is_empty() || raw.starts_with('.') || raw.ends_with('.') {
        return Err(LeaderboardError::Horizon(
            "Reputation balance is invalid".into(),
        ));
    }
    let (whole, frac) = match raw.split_once('.') {
        Some((whole, frac)) => (whole, frac),
        None => (raw, ""),
    };
    if whole.is_empty()
        || !whole.chars().all(|c| c.is_ascii_digit())
        || !frac.chars().all(|c| c.is_ascii_digit())
        || frac.len() > 7
    {
        return Err(LeaderboardError::Horizon(
            "Reputation balance is invalid".into(),
        ));
    }
    let mut digits = String::with_capacity(whole.len() + 7);
    digits.push_str(whole);
    digits.push_str(frac);
    for _ in frac.len()..7 {
        digits.push('0');
    }
    let value: u64 = digits
        .parse()
        .map_err(|_| LeaderboardError::Horizon("Reputation balance is invalid".into()))?;
    if value > i64::MAX as u64 {
        return Err(LeaderboardError::Horizon(
            "Reputation balance is invalid".into(),
        ));
    }
    let signed = value as i64;
    Ok(if negative { -signed } else { signed })
}

pub fn format_stroops(stroops: i64) -> String {
    let negative = stroops < 0;
    let value = stroops.unsigned_abs();
    let whole = value / STROOPS as u64;
    let frac = value % STROOPS as u64;
    let mut text = format!("{whole}.{frac:07}");
    while text.ends_with('0') {
        text.pop();
    }
    if text.ends_with('.') {
        text.pop();
    }
    if negative {
        format!("-{text}")
    } else {
        text
    }
}

fn rank(state: &BoardState, community_id: &str, tournament_id: Option<&str>) -> BoardView {
    let mut rows: Vec<&Member> = state
        .members
        .iter()
        .filter(|row| row.community_id == community_id)
        .filter(|row| tournament_id.is_none() || row.tournament_id.as_deref() == tournament_id)
        .collect();
    rows.sort_by(|left, right| {
        right
            .reputation_stroops
            .cmp(&left.reputation_stroops)
            .then_with(|| left.username.cmp(&right.username))
            .then_with(|| left.user_id.cmp(&right.user_id))
    });
    let entries = rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| RankedPlayer {
            rank: (index + 1) as i32,
            user_id: row.user_id,
            username: row.username.clone(),
            reputation: format_stroops(row.reputation_stroops),
            reputation_stroops: row.reputation_stroops,
        })
        .collect();
    BoardView {
        community_id: community_id.to_string(),
        tournament_id: tournament_id.map(str::to_string),
        version: state.version,
        entries,
    }
}

async fn fetch_horizon_account(
    http: &reqwest::Client,
    horizon_url: &str,
    public_key: &str,
) -> Result<serde_json::Value, LeaderboardError> {
    if horizon_url.is_empty() {
        return Err(LeaderboardError::Horizon(
            "Horizon URL is not configured".into(),
        ));
    }
    let url = format!("{horizon_url}/accounts/{public_key}");
    let response = http
        .get(&url)
        .send()
        .await
        .map_err(|error| LeaderboardError::Horizon(error.to_string()))?;
    if !response.status().is_success() {
        return Err(LeaderboardError::Horizon(format!(
            "Horizon returned {}",
            response.status()
        )));
    }
    response
        .json()
        .await
        .map_err(|error| LeaderboardError::Horizon(error.to_string()))
}

fn map_error(error: LeaderboardError) -> ApiError {
    match error {
        LeaderboardError::NotFound => ApiError::not_found("missing"),
        LeaderboardError::Conflict(message) => ApiError::conflict(message),
        LeaderboardError::NotConfigured => ApiError::ServiceUnavailable(error.to_string()),
        LeaderboardError::Horizon(message) => ApiError::BadRequest(message),
        LeaderboardError::Store(message) => ApiError::ServiceUnavailable(message),
        LeaderboardError::Invalid(message) => ApiError::bad_request(message),
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

#[derive(Debug, Deserialize)]
struct BoardQuery {
    community: String,
    tournament: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RegisterBody {
    user_id: Uuid,
    username: String,
    community_id: String,
    tournament_id: Option<String>,
    public_key: String,
}

#[derive(Debug, Deserialize)]
struct SyncBody {
    public_key: String,
}

async fn get_board(
    board: web::Data<Arc<CommunityLeaderboard>>,
    query: web::Query<BoardQuery>,
) -> Result<HttpResponse, ApiError> {
    let view = board
        .board(&query.community, query.tournament.as_deref())
        .await
        .map_err(map_error)?;
    Ok(HttpResponse::Ok().json(view))
}

async fn register_member(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    board: web::Data<Arc<CommunityLeaderboard>>,
    body: web::Json<RegisterBody>,
) -> Result<HttpResponse, ApiError> {
    let claims = caller(&req, jwt.get_ref()).await?;
    let is_admin = claims.roles.iter().any(|role| role == "admin");
    if claims.sub != body.user_id.to_string() && !is_admin {
        return Err(ApiError::forbidden(
            "You can only register your own account",
        ));
    }
    let view = board
        .register(NewMember {
            user_id: body.user_id,
            username: body.username.clone(),
            community_id: body.community_id.clone(),
            tournament_id: body.tournament_id.clone(),
            public_key: body.public_key.clone(),
        })
        .await
        .map_err(map_error)?;
    Ok(HttpResponse::Ok().json(view))
}

async fn sync_reputation(
    req: HttpRequest,
    jwt: web::Data<Arc<JwtService>>,
    board: web::Data<Arc<CommunityLeaderboard>>,
    body: web::Json<SyncBody>,
) -> Result<HttpResponse, ApiError> {
    caller(&req, jwt.get_ref()).await?;
    let view = board
        .sync_public_key(&body.public_key)
        .await
        .map_err(map_error)?;
    Ok(HttpResponse::Ok().json(view))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/community/leaderboard")
            .route("", web::get().to(get_board))
            .route("/members", web::post().to(register_member))
            .route("/sync", web::post().to(sync_reputation)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(seed: u8) -> String {
        let mut payload = [0u8; 32];
        payload[0] = seed;
        stellar_strkey_encode(PUBLIC_KEY_VERSION, &payload).unwrap()
    }

    fn member(seed: u8, username: &str, tournament: Option<&str>) -> NewMember {
        NewMember {
            user_id: Uuid::from_u128(seed as u128),
            username: username.into(),
            community_id: "ArenaX".into(),
            tournament_id: tournament.map(str::to_string),
            public_key: key(seed),
        }
    }

    #[test]
    fn decimal_balances_become_stroops_without_floats() {
        assert_eq!(stroops_from_decimal("10").unwrap(), 100_000_000);
        assert_eq!(stroops_from_decimal("0.1").unwrap(), 1_000_000);
        assert_eq!(stroops_from_decimal("42.5000000").unwrap(), 425_000_000);
        assert!(stroops_from_decimal("1.00000001").is_err());
        assert!(stroops_from_decimal(".5").is_err());
        assert_eq!(format_stroops(425_000_000), "42.5");
        assert_eq!(format_stroops(0), "0");
    }

    #[test]
    fn horizon_payload_uses_only_the_reputation_asset() {
        let issuer = "GISSUE";
        let account = serde_json::json!({
            "balances": [
                {"asset_type": "native", "balance": "99.0"},
                {"asset_type": "credit_alphanum4", "asset_code": "AX", "asset_issuer": issuer, "balance": "8.0"},
                {"asset_type": "credit_alphanum4", "asset_code": "REP", "asset_issuer": "GOTHER", "balance": "7.0"},
                {"asset_type": "credit_alphanum12", "asset_code": "REP", "asset_issuer": issuer, "balance": "3.25"}
            ]
        });
        assert_eq!(
            reputation_stroops(&account, "REP", issuer).unwrap(),
            32_500_000
        );
        assert!(reputation_stroops(&account, "REP", "GMISSING").is_err());
    }

    #[tokio::test]
    async fn rankings_filter_by_community_and_tournament_and_publish() {
        let board = CommunityLeaderboard::memory("https://horizon.test", "REP", "GISSUE");
        board
            .register(member(1, "ada", Some("weekly")))
            .await
            .unwrap();
        board
            .register(member(2, "bob", Some("weekly")))
            .await
            .unwrap();
        board
            .register(member(3, "cy", Some("finals")))
            .await
            .unwrap();
        board.register(member(4, "dee", None)).await.unwrap();

        board.apply_balance(&key(1), 10_000_000).await.unwrap();
        board.apply_balance(&key(2), 50_000_000).await.unwrap();
        board.apply_balance(&key(3), 90_000_000).await.unwrap();

        let community = board.board("arenax", None).await.unwrap();
        assert_eq!(
            community
                .entries
                .iter()
                .map(|row| row.username.as_str())
                .collect::<Vec<_>>(),
            vec!["cy", "bob", "ada", "dee"]
        );
        assert_eq!(community.entries[0].reputation, "9");
        assert_eq!(community.entries[0].rank, 1);

        let weekly = board.board("arenax", Some("weekly")).await.unwrap();
        assert_eq!(
            weekly
                .entries
                .iter()
                .map(|row| row.username.as_str())
                .collect::<Vec<_>>(),
            vec!["bob", "ada"]
        );
        assert!(weekly.entries.iter().all(|row| row.username != "cy"));

        let events = board.published();
        assert!(events.iter().any(|event| matches!(
            event,
            RealtimeEvent::CommunityLeaderboard { tournament_id: None, community_id, .. } if community_id == "arenax"
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            RealtimeEvent::CommunityLeaderboard { tournament_id: Some(tournament), .. } if tournament == "weekly"
        )));

        let stale = board.apply_balance(&key(2), 1).await.unwrap();
        assert!(stale.version > community.version);
        assert_eq!(stale.entries[0].username, "cy");
    }

    #[tokio::test]
    async fn duplicate_stellar_account_is_rejected() {
        let board = CommunityLeaderboard::memory("https://horizon.test", "REP", "");
        board.register(member(1, "ada", None)).await.unwrap();
        let mut other = member(1, "bob", None);
        other.user_id = Uuid::from_u128(9);
        other.public_key = key(1);
        assert!(matches!(
            board.register(other).await,
            Err(LeaderboardError::Conflict(_))
        ));
        assert!(board.sync_public_key(&key(1)).await.is_err());
    }

    #[test]
    fn community_channel_requires_a_lowercase_slug() {
        assert!(authorize_community_channel("community:arenax").is_ok());
        assert!(authorize_community_channel("community:Arenax").is_err());
        assert!(authorize_community_channel("user:arenax").is_err());
    }
}
