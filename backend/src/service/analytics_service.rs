/// Analytics service — aggregates on-chain and off-chain metrics.
/// Privacy: player-level data is only returned to the player themselves or admins.
use crate::api_error::ApiError;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

// ─── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct GameMetricsResponse {
    pub game_id: i32,
    pub total_matches: i64,
    pub total_players: i64,
    pub total_wagered: i64,
    pub total_rewards_paid: i64,
    pub avg_match_duration_secs: i64,
    pub last_updated: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PlatformMetricsResponse {
    pub total_matches_all_time: i64,
    pub active_players_30d: i64,
    pub total_staked: i64,
    pub total_volume: i64,
    pub last_updated: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct PlayerInsightsResponse {
    pub user_id: Uuid,
    pub game_id: i32,
    pub matches_played: i64,
    pub win_rate_pct: f64,
    pub avg_session_secs: i64,
    pub last_active: chrono::DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct RecordMatchRequest {
    pub game_id: i32,
    pub match_id: Uuid,
    pub duration_secs: i64,
    pub wager_amount: i64,
    pub reward_amount: i64,
    pub player_count: i32,
}

// ─── DB rows ──────────────────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct GameMetricsRow {
    pub game_id: i32,
    pub total_matches: i64,
    pub total_players: i64,
    pub total_wagered: i64,
    pub total_rewards_paid: i64,
    pub avg_match_duration_secs: i64,
    pub last_updated: chrono::DateTime<Utc>,
}

#[derive(sqlx::FromRow)]
struct PlayerInsightsRow {
    pub user_id: Uuid,
    pub game_id: i32,
    pub matches_played: i64,
    pub wins: i64,
    pub avg_session_secs: i64,
    pub last_active: chrono::DateTime<Utc>,
}

// ─── Service ──────────────────────────────────────────────────────────────────

pub struct AnalyticsService {
    db: PgPool,
}

impl AnalyticsService {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    /// Record a completed match (called by match service after resolution).
    pub async fn record_match(&self, req: &RecordMatchRequest) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            INSERT INTO analytics_game_metrics
                (game_id, total_matches, total_players, total_wagered,
                 total_rewards_paid, avg_match_duration_secs, last_updated)
            VALUES ($1, 1, $2, $3, $4, $5, NOW())
            ON CONFLICT (game_id) DO UPDATE SET
                total_matches            = analytics_game_metrics.total_matches + 1,
                total_players            = analytics_game_metrics.total_players + EXCLUDED.total_players,
                total_wagered            = analytics_game_metrics.total_wagered + EXCLUDED.total_wagered,
                total_rewards_paid       = analytics_game_metrics.total_rewards_paid + EXCLUDED.total_rewards_paid,
                avg_match_duration_secs  = (
                    analytics_game_metrics.avg_match_duration_secs
                    * analytics_game_metrics.total_matches
                    + EXCLUDED.avg_match_duration_secs
                ) / (analytics_game_metrics.total_matches + 1),
                last_updated             = NOW()
            "#,
            req.game_id,
            req.player_count as i64,
            req.wager_amount,
            req.reward_amount,
            req.duration_secs,
        )
        .execute(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        // Update platform totals
        sqlx::query!(
            r#"
            INSERT INTO analytics_platform (id, total_matches_all_time, total_volume, last_updated)
            VALUES (1, 1, $1, NOW())
            ON CONFLICT (id) DO UPDATE SET
                total_matches_all_time = analytics_platform.total_matches_all_time + 1,
                total_volume           = analytics_platform.total_volume + EXCLUDED.total_volume,
                last_updated           = NOW()
            "#,
            req.wager_amount,
        )
        .execute(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        Ok(())
    }

    /// Record player behaviour (privacy-safe: no PII in analytics tables).
    pub async fn record_player_behaviour(
        &self,
        user_id: Uuid,
        game_id: i32,
        won: bool,
        session_secs: i64,
    ) -> Result<(), ApiError> {
        sqlx::query!(
            r#"
            INSERT INTO analytics_player_behaviour
                (user_id, game_id, matches_played, wins, avg_session_secs, last_active)
            VALUES ($1, $2, 1, $3, $4, NOW())
            ON CONFLICT (user_id, game_id) DO UPDATE SET
                matches_played   = analytics_player_behaviour.matches_played + 1,
                wins             = analytics_player_behaviour.wins + EXCLUDED.wins,
                avg_session_secs = (
                    analytics_player_behaviour.avg_session_secs
                    * analytics_player_behaviour.matches_played
                    + EXCLUDED.avg_session_secs
                ) / (analytics_player_behaviour.matches_played + 1),
                last_active      = NOW()
            "#,
            user_id,
            game_id,
            if won { 1i64 } else { 0i64 },
            session_secs,
        )
        .execute(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        Ok(())
    }

    pub async fn get_game_metrics(
        &self,
        game_id: i32,
    ) -> Result<Option<GameMetricsResponse>, ApiError> {
        let row = sqlx::query_as!(
            GameMetricsRow,
            "SELECT * FROM analytics_game_metrics WHERE game_id = $1",
            game_id
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        Ok(row.map(|r| GameMetricsResponse {
            game_id: r.game_id,
            total_matches: r.total_matches,
            total_players: r.total_players,
            total_wagered: r.total_wagered,
            total_rewards_paid: r.total_rewards_paid,
            avg_match_duration_secs: r.avg_match_duration_secs,
            last_updated: r.last_updated,
        }))
    }

    pub async fn get_platform_metrics(&self) -> Result<PlatformMetricsResponse, ApiError> {
        let row = sqlx::query!(
            r#"
            SELECT
                COALESCE(total_matches_all_time, 0) AS "total_matches_all_time!: i64",
                COALESCE(active_players_30d, 0)     AS "active_players_30d!: i64",
                COALESCE(total_staked, 0)            AS "total_staked!: i64",
                COALESCE(total_volume, 0)            AS "total_volume!: i64",
                last_updated
            FROM analytics_platform WHERE id = 1
            "#
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        Ok(row.map(|r| PlatformMetricsResponse {
            total_matches_all_time: r.total_matches_all_time,
            active_players_30d: r.active_players_30d,
            total_staked: r.total_staked,
            total_volume: r.total_volume,
            last_updated: r.last_updated.unwrap_or_else(Utc::now),
        }).unwrap_or(PlatformMetricsResponse {
            total_matches_all_time: 0,
            active_players_30d: 0,
            total_staked: 0,
            total_volume: 0,
            last_updated: Utc::now(),
        }))
    }

    /// Player insights — only accessible by the player or an admin.
    pub async fn get_player_insights(
        &self,
        requesting_user_id: Uuid,
        target_user_id: Uuid,
        is_admin: bool,
        game_id: i32,
    ) -> Result<Option<PlayerInsightsResponse>, ApiError> {
        if requesting_user_id != target_user_id && !is_admin {
            return Err(ApiError::Forbidden("not authorised to view this data".into()));
        }

        let row = sqlx::query_as!(
            PlayerInsightsRow,
            r#"
            SELECT user_id, game_id, matches_played, wins, avg_session_secs, last_active
            FROM analytics_player_behaviour
            WHERE user_id = $1 AND game_id = $2
            "#,
            target_user_id,
            game_id,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(|e| ApiError::InternalServerError(e.to_string()))?;

        Ok(row.map(|r| {
            let win_rate = if r.matches_played > 0 {
                r.wins as f64 / r.matches_played as f64 * 100.0
            } else {
                0.0
            };
            PlayerInsightsResponse {
                user_id: r.user_id,
                game_id: r.game_id,
                matches_played: r.matches_played,
                win_rate_pct: (win_rate * 10.0).round() / 10.0,
                avg_session_secs: r.avg_session_secs,
                last_active: r.last_active,
            }
        }))
    }
}
