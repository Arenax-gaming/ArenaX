use crate::api_error::ApiError;
use crate::models::{
    EloHistoryResponse, EloProgressionPoint, EloRecord, EloSnapshot, EloVolatility,
    LeaderboardEntry, LeaderboardResponse, PlayerRankResponse, RankHistory, RankHistoryEntry,
    SeasonalLeaderboard, LeaderboardStats,
};
use chrono::{DateTime, NaiveDate, Utc, Duration};
use sqlx::PgPool;
use uuid::Uuid;

pub struct LeaderboardService {
    db_pool: PgPool,
}

impl LeaderboardService {
    pub fn new(db_pool: PgPool) -> Self {
        Self { db_pool }
    }

    /// Get leaderboard rankings for a category (optimized with single query)
    pub async fn get_leaderboard(
        &self,
        category: &str,
        limit: i64,
        offset: i64,
    ) -> Result<LeaderboardResponse, ApiError> {
        // Optimized: use window function to get count in same query
        let entries = sqlx::query_as::<_, (Uuid, Uuid, String, Option<String>, i32, i32, i32, i32, i32, f64, String, DateTime<Utc>, i64)>(
            r#"
            SELECT 
                l.id, l.user_id, u.username, u.avatar_url,
                l.ranking, l.elo_rating, l.matches_played, l.wins, l.losses, l.win_rate,
                l.period, l.updated_at,
                COUNT(*) OVER() as total_count
            FROM leaderboards l
            INNER JOIN users u ON l.user_id = u.id
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

        let total_count = entries.first().map(|e| e.12).unwrap_or(0);

        let leaderboard_entries = entries
            .into_iter()
            .map(|(id, user_id, username, avatar_url, ranking, elo_rating, matches_played, wins, losses, win_rate, period, updated_at, _)| {
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

    /// Get seasonal leaderboard rankings (optimized with single query)
    pub async fn get_seasonal_leaderboard(
        &self,
        category: &str,
        season: &str,
        limit: i64,
        offset: i64,
    ) -> Result<SeasonalLeaderboard, ApiError> {
        // Optimized: use window function to get count in same query
        let entries = sqlx::query_as::<_, (Uuid, Uuid, String, Option<String>, i32, i32, i32, i32, i32, f64, String, DateTime<Utc>, i64)>(
            r#"
            SELECT 
                l.id, l.user_id, u.username, u.avatar_url,
                l.ranking, l.elo_rating, l.matches_played, l.wins, l.losses, l.win_rate,
                l.period, l.updated_at,
                COUNT(*) OVER() as total_count
            FROM leaderboards l
            INNER JOIN users u ON l.user_id = u.id
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

        let total_count = entries.first().map(|e| e.12).unwrap_or(0);

        let leaderboard_entries = entries
            .into_iter()
            .map(|(id, user_id, username, avatar_url, ranking, elo_rating, matches_played, wins, losses, win_rate, period, updated_at, _)| {
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

    /// Update player rank (optimized with batching support)
    pub async fn update_player_rank(
        &self,
        category: &str,
        player_id: Uuid,
    ) -> Result<(), ApiError> {
        // Optimized: batch Elo rating and match stats queries
        let player_stats = sqlx::query_as::<_, (Option<i32>, i32, i32, i32)>(
            r#"
            SELECT 
                ue.current_rating,
                COUNT(m.id)::int as matches_played,
                SUM(CASE WHEN m.winner_id = $1 THEN 1 ELSE 0 END)::int as wins,
                SUM(CASE WHEN m.winner_id != $1 AND (m.player1_id = $1 OR m.player2_id = $1) THEN 1 ELSE 0 END)::int as losses
            FROM user_elo ue
            LEFT JOIN matches m ON (m.player1_id = $1 OR m.player2_id = $1) AND m.game_mode = $2 AND m.status = 3
            WHERE ue.user_id = $1 AND ue.game = $2
            GROUP BY ue.current_rating
            "#
        )
        .bind(player_id)
        .bind(category)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let (elo_rating_opt, matches_played, wins, losses) = player_stats.unwrap_or((None, 0, 0, 0));
        let elo_rating = elo_rating_opt.unwrap_or(1200);

        let win_rate = if matches_played > 0 {
            (wins as f64 / matches_played as f64) * 100.0
        } else {
            0.0
        };

        // Optimized: get ranking with a more efficient subquery
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

    /// Batch update player ranks for multiple players (optimized for refresh)
    pub async fn batch_update_player_ranks(
        &self,
        category: &str,
        player_ids: &[Uuid],
    ) -> Result<(), ApiError> {
        if player_ids.is_empty() {
            return Ok(());
        }

        // Batch process in chunks of 100 to avoid overwhelming the database
        const BATCH_SIZE: usize = 100;
        
        for chunk in player_ids.chunks(BATCH_SIZE) {
            // Process chunk concurrently using futures
            let mut tasks = Vec::new();
            for &player_id in chunk {
                tasks.push(self.update_player_rank(category, player_id));
            }
            
            // Wait for all tasks in this chunk to complete
            for task in tasks {
                task.await?;
            }
        }

        Ok(())
    }

    /// Refresh entire leaderboard for a category (optimized with batching)
    pub async fn refresh_leaderboard(&self, category: &str) -> Result<(), ApiError> {
        // Get all players with Elo ratings for this category
        let players = sqlx::query_scalar::<_, Uuid>(
            "SELECT DISTINCT user_id FROM user_elo WHERE game = $1"
        )
        .bind(category)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        // Use batch update instead of sequential processing
        self.batch_update_player_ranks(category, &players).await?;

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

    /// Get one end-of-day ELO snapshot per day for a player within a date range.
    /// Derived from `elo_history` (populated on every rated match) rather than a
    /// separately maintained table, so snapshots are always consistent with match results.
    pub async fn get_elo_snapshots(
        &self,
        player_id: Uuid,
        category: &str,
        start_date: DateTime<Utc>,
        end_date: DateTime<Utc>,
    ) -> Result<Vec<EloSnapshot>, ApiError> {
        if start_date > end_date {
            return Err(ApiError::bad_request("start_date must be before end_date"));
        }

        let snapshots = sqlx::query_as::<_, (NaiveDate, i32)>(
            r#"
            SELECT DISTINCT ON (day) day, rating_after
            FROM (
                SELECT (created_at AT TIME ZONE 'UTC')::date AS day, rating_after, created_at
                FROM elo_history
                WHERE user_id = $1 AND game = $2 AND created_at BETWEEN $3 AND $4
            ) daily
            ORDER BY day, created_at DESC
            "#
        )
        .bind(player_id)
        .bind(category)
        .bind(start_date)
        .bind(end_date)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(snapshots
            .into_iter()
            .map(|(date, elo_rating)| EloSnapshot { date, elo_rating })
            .collect())
    }

    fn build_progression(snapshots: &[EloSnapshot]) -> Vec<EloProgressionPoint> {
        let mut previous_elo: Option<i32> = None;
        snapshots
            .iter()
            .map(|snapshot| {
                let change_from_previous = previous_elo
                    .map(|prev| snapshot.elo_rating - prev)
                    .unwrap_or(0);
                previous_elo = Some(snapshot.elo_rating);
                EloProgressionPoint {
                    date: snapshot.date,
                    elo_rating: snapshot.elo_rating,
                    change_from_previous,
                }
            })
            .collect()
    }

    /// Get day-by-day ELO progression chart data (with change from the previous day)
    /// for a player within a date range.
    pub async fn get_elo_progression(
        &self,
        player_id: Uuid,
        category: &str,
        start_date: DateTime<Utc>,
        end_date: DateTime<Utc>,
    ) -> Result<Vec<EloProgressionPoint>, ApiError> {
        let snapshots = self
            .get_elo_snapshots(player_id, category, start_date, end_date)
            .await?;

        Ok(Self::build_progression(&snapshots))
    }

    /// Get the highest and lowest ELO ratings recorded for a player within a date range.
    pub async fn get_elo_extremes(
        &self,
        player_id: Uuid,
        category: &str,
        start_date: DateTime<Utc>,
        end_date: DateTime<Utc>,
    ) -> Result<(Option<EloRecord>, Option<EloRecord>), ApiError> {
        let highest = sqlx::query_as::<_, (i32, DateTime<Utc>, Option<Uuid>)>(
            r#"
            SELECT rating_after, created_at, match_id
            FROM elo_history
            WHERE user_id = $1 AND game = $2 AND created_at BETWEEN $3 AND $4
            ORDER BY rating_after DESC, created_at ASC
            LIMIT 1
            "#
        )
        .bind(player_id)
        .bind(category)
        .bind(start_date)
        .bind(end_date)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let lowest = sqlx::query_as::<_, (i32, DateTime<Utc>, Option<Uuid>)>(
            r#"
            SELECT rating_after, created_at, match_id
            FROM elo_history
            WHERE user_id = $1 AND game = $2 AND created_at BETWEEN $3 AND $4
            ORDER BY rating_after ASC, created_at ASC
            LIMIT 1
            "#
        )
        .bind(player_id)
        .bind(category)
        .bind(start_date)
        .bind(end_date)
        .fetch_optional(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let to_record = |row: (i32, DateTime<Utc>, Option<Uuid>)| EloRecord {
            elo_rating: row.0,
            recorded_at: row.1,
            match_id: row.2,
        };

        Ok((highest.map(to_record), lowest.map(to_record)))
    }

    /// Get ELO volatility metrics (standard deviation and average magnitude of rating
    /// changes) for a player within a date range.
    pub async fn get_elo_volatility(
        &self,
        player_id: Uuid,
        category: &str,
        start_date: DateTime<Utc>,
        end_date: DateTime<Utc>,
    ) -> Result<EloVolatility, ApiError> {
        let (std_deviation, average_change, max_swing, sample_size) = sqlx::query_as::<
            _,
            (Option<f64>, Option<f64>, Option<i32>, i64),
        >(
            r#"
            SELECT
                STDDEV_POP(rating_change::float8) as std_deviation,
                AVG(ABS(rating_change))::float8 as average_change,
                MAX(ABS(rating_change)) as max_swing,
                COUNT(*) as sample_size
            FROM elo_history
            WHERE user_id = $1 AND game = $2 AND created_at BETWEEN $3 AND $4
            "#
        )
        .bind(player_id)
        .bind(category)
        .bind(start_date)
        .bind(end_date)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(EloVolatility {
            std_deviation: std_deviation.unwrap_or(0.0),
            average_change: average_change.unwrap_or(0.0),
            max_swing: max_swing.unwrap_or(0),
            sample_size,
        })
    }

    /// Get full historical ELO analytics for a player: daily snapshots, progression
    /// chart data, highest/lowest records, and volatility — all scoped to a date range.
    pub async fn get_elo_history(
        &self,
        player_id: Uuid,
        category: &str,
        start_date: DateTime<Utc>,
        end_date: DateTime<Utc>,
    ) -> Result<EloHistoryResponse, ApiError> {
        if start_date > end_date {
            return Err(ApiError::bad_request("start_date must be before end_date"));
        }

        let username = sqlx::query_scalar::<_, String>("SELECT username FROM users WHERE id = $1")
            .bind(player_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::DatabaseError(e))?
            .ok_or_else(|| ApiError::NotFound)?;

        let snapshots = self
            .get_elo_snapshots(player_id, category, start_date, end_date)
            .await?;
        let progression = Self::build_progression(&snapshots);
        let (highest, lowest) = self
            .get_elo_extremes(player_id, category, start_date, end_date)
            .await?;
        let volatility = self
            .get_elo_volatility(player_id, category, start_date, end_date)
            .await?;

        Ok(EloHistoryResponse {
            user_id: player_id,
            username,
            category: category.to_string(),
            start_date,
            end_date,
            snapshots,
            progression,
            highest,
            lowest,
            volatility,
        })
    }
}
