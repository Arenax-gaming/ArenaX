use crate::api_error::ApiError;
use crate::models::{
    LeaderboardEntry, LeaderboardResponse, PlayerRankResponse, RankHistory, RankHistoryEntry,
    SeasonalLeaderboard, LeaderboardStats,
};
use chrono::{DateTime, Utc, Duration};
use sqlx::PgPool;
use uuid::Uuid;

pub struct LeaderboardService {
    db_pool: PgPool,
}

impl LeaderboardService {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }

    /// Get leaderboard rankings for a category
    pub async fn get_leaderboard(
        &self,
        category: &str,
        limit: i64,
        offset: i64,
    ) -> Result<LeaderboardResponse, ApiError> {
        let entries = sqlx::query_as::<_, (Uuid, Uuid, String, Option<String>, i32, i32, i32, i32, i32, f64, String, DateTime<Utc>)>(
            r#"
            SELECT 
                l.id, l.user_id, u.username, u.avatar_url,
                l.ranking, l.elo_rating, l.matches_played, l.wins, l.losses, l.win_rate,
                l.period, l.updated_at
            FROM leaderboards l
            JOIN users u ON l.user_id = u.id
            WHERE l.game = $1 AND l.period = 'all_time'
            ORDER BY l.ranking ASC
            LIMIT $2 OFFSET $3
            "#
        )
        .bind(category)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let total_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM leaderboards WHERE game = $1 AND period = 'all_time'"
        )
        .bind(category)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let leaderboard_entries = entries
            .into_iter()
            .map(|(id, user_id, username, avatar_url, ranking, elo_rating, matches_played, wins, losses, win_rate, period, updated_at)| {
                LeaderboardEntry {
                    id,
                    user_id,
                    username,
                    avatar_url,
                    ranking,
                    elo_rating,
                    matches_played,
                    wins,
                    losses,
                    win_rate,
                    period,
                    updated_at,
                }
            })
            .collect();

        Ok(LeaderboardResponse {
            entries: leaderboard_entries,
            total_count,
            period: "all_time".to_string(),
            category: category.to_string(),
        })
    }

    /// Get seasonal leaderboard rankings
    pub async fn get_seasonal_leaderboard(
        &self,
        category: &str,
        season: &str,
        limit: i64,
        offset: i64,
    ) -> Result<SeasonalLeaderboard, ApiError> {
        let entries = sqlx::query_as::<_, (Uuid, Uuid, String, Option<String>, i32, i32, i32, i32, i32, f64, String, DateTime<Utc>)>(
            r#"
            SELECT 
                l.id, l.user_id, u.username, u.avatar_url,
                l.ranking, l.elo_rating, l.matches_played, l.wins, l.losses, l.win_rate,
                l.period, l.updated_at
            FROM leaderboards l
            JOIN users u ON l.user_id = u.id
            WHERE l.game = $1 AND l.period = $2
            ORDER BY l.ranking ASC
            LIMIT $3 OFFSET $4
            "#
        )
        .bind(category)
        .bind(season)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let total_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM leaderboards WHERE game = $1 AND period = $2"
        )
        .bind(category)
        .bind(season)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let leaderboard_entries = entries
            .into_iter()
            .map(|(id, user_id, username, avatar_url, ranking, elo_rating, matches_played, wins, losses, win_rate, period, updated_at)| {
                LeaderboardEntry {
                    id,
                    user_id,
                    username,
                    avatar_url,
                    ranking,
                    elo_rating,
                    matches_played,
                    wins,
                    losses,
                    win_rate,
                    period,
                    updated_at,
                }
            })
            .collect();

        Ok(SeasonalLeaderboard {
            season_id: season.to_string(),
            season_name: format!("Season {}", season),
            start_date: Utc::now() - Duration::days(30),
            end_date: Utc::now(),
            entries: leaderboard_entries,
            total_participants: total_count,
        })
    }

    /// Get player's rank in a category
    pub async fn get_player_rank(
        &self,
        category: &str,
        player_id: Uuid,
    ) -> Result<PlayerRankResponse, ApiError> {
        let player = sqlx::query_as::<_, (Uuid, String, Option<String>, i32, i32, i32, i32, i32, f64, DateTime<Utc>)>(
            r#"
            SELECT 
                l.user_id, u.username, u.avatar_url,
                l.ranking, l.elo_rating, l.matches_played, l.wins, l.losses, l.win_rate,
                l.updated_at
            FROM leaderboards l
            JOIN users u ON l.user_id = u.id
            WHERE l.game = $1 AND l.user_id = $2 AND l.period = 'all_time'
            "#
        )
        .bind(category)
        .bind(player_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .ok_or_else(|| ApiError::NotFound)?;

        let (user_id, username, avatar_url, ranking, elo_rating, matches_played, wins, losses, win_rate, updated_at) = player;

        // Get rank change from previous period
        let previous_rank = sqlx::query_scalar::<_, Option<i32>>(
            r#"
            SELECT ranking FROM leaderboards 
            WHERE game = $1 AND user_id = $2 AND period = 'weekly'
            ORDER BY updated_at DESC LIMIT 1
            "#
        )
        .bind(category)
        .bind(player_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .flatten();

        let rank_change = previous_rank.map(|prev| prev - ranking);

        Ok(PlayerRankResponse {
            user_id,
            username,
            avatar_url,
            current_rank: ranking,
            elo_rating,
            matches_played,
            wins,
            losses,
            win_rate,
            rank_change,
            updated_at,
        })
    }

    /// Get player's rank history
    pub async fn get_rank_history(
        &self,
        player_id: Uuid,
        category: &str,
        days: i64,
    ) -> Result<RankHistory, ApiError> {
        let username = sqlx::query_scalar::<_, String>(
            "SELECT username FROM users WHERE id = $1"
        )
        .bind(player_id)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .ok_or_else(|| ApiError::NotFound)?;

        let history = sqlx::query_as::<_, (i32, i32, String, DateTime<Utc>)>(
            r#"
            SELECT ranking, elo_rating, period, updated_at
            FROM leaderboards
            WHERE user_id = $1 AND game = $2 AND updated_at > NOW() - INTERVAL '1 day' * $3
            ORDER BY updated_at DESC
            "#
        )
        .bind(player_id)
        .bind(category)
        .bind(days)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let history_entries = history
            .into_iter()
            .map(|(rank, elo_rating, period, timestamp)| {
                RankHistoryEntry {
                    rank,
                    elo_rating,
                    period,
                    timestamp,
                }
            })
            .collect();

        Ok(RankHistory {
            user_id: player_id,
            username,
            history: history_entries,
        })
    }

    /// Update player rank (called after match completion)
    pub async fn update_player_rank(
        &self,
        category: &str,
        player_id: Uuid,
    ) -> Result<(), ApiError> {
        // Calculate new ranking based on Elo rating
        let elo_rating = sqlx::query_scalar::<_, i32>(
            "SELECT current_rating FROM user_elo WHERE user_id = $1 AND game = $2"
        )
        .bind(player_id)
        .bind(category)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .unwrap_or(1200);

        let matches_stats = sqlx::query_as::<_, (i32, i32, i32)>(
            r#"
            SELECT 
                COUNT(*)::int as matches_played,
                SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END)::int as wins,
                SUM(CASE WHEN winner_id != $1 AND player1_id = $1 OR player2_id = $1 THEN 1 ELSE 0 END)::int as losses
            FROM matches
            WHERE (player1_id = $1 OR player2_id = $1) AND game_mode = $2 AND status = 3
            "#
        )
        .bind(player_id)
        .bind(category)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?
        .unwrap_or((0, 0, 0));

        let (matches_played, wins, losses) = matches_stats;
        let win_rate = if matches_played > 0 {
            (wins as f64 / matches_played as f64) * 100.0
        } else {
            0.0
        };

        // Get new ranking based on Elo
        let new_ranking = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*) + 1 FROM user_elo 
            WHERE game = $1 AND current_rating > $2
            "#
        )
        .bind(category)
        .bind(elo_rating)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))? as i32;

        // Upsert leaderboard entry
        sqlx::query(
            r#"
            INSERT INTO leaderboards (user_id, game, period, ranking, elo_rating, matches_played, wins, losses, win_rate, period_start, period_end, updated_at)
            VALUES ($1, $2, 'all_time', $3, $4, $5, $6, $7, $8, NOW(), NOW() + INTERVAL '1 year', NOW())
            ON CONFLICT (user_id, game, period, period_start) DO UPDATE SET
                ranking = $3,
                elo_rating = $4,
                matches_played = $5,
                wins = $6,
                losses = $7,
                win_rate = $8,
                updated_at = NOW()
            "#
        )
        .bind(player_id)
        .bind(category)
        .bind(new_ranking)
        .bind(elo_rating)
        .bind(matches_played)
        .bind(wins)
        .bind(losses)
        .bind(win_rate)
        .execute(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(())
    }

    /// Refresh entire leaderboard for a category
    pub async fn refresh_leaderboard(&self, category: &str) -> Result<(), ApiError> {
        // Get all players with Elo ratings for this category
        let players = sqlx::query_as::<_, (Uuid,)>(
            "SELECT DISTINCT user_id FROM user_elo WHERE game = $1"
        )
        .bind(category)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        for (player_id,) in players {
            self.update_player_rank(category, player_id).await?;
        }

        Ok(())
    }

    /// Get leaderboard statistics
    pub async fn get_leaderboard_stats(&self, category: &str) -> Result<LeaderboardStats, ApiError> {
        let stats = sqlx::query_as::<_, (i64, Option<f64>, Option<i32>, Option<i32>)>(
            r#"
            SELECT 
                COUNT(DISTINCT user_id) as total_players,
                AVG(elo_rating)::float as average_elo,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY elo_rating) as median_elo,
                MAX(elo_rating) as top_player_elo
            FROM leaderboards
            WHERE game = $1 AND period = 'all_time'
            "#
        )
        .bind(category)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let (total_players, average_elo, median_elo, top_player_elo) = stats;

        Ok(LeaderboardStats {
            total_players,
            average_elo: average_elo.unwrap_or(0.0),
            median_elo: median_elo.unwrap_or(1200),
            top_player_elo: top_player_elo.unwrap_or(1200),
            last_updated: Utc::now(),
        })
    }
}
