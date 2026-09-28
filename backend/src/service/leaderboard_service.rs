use crate::api_error::ApiError;
use crate::models::{
    CloseSeasonResponse, LeaderboardEntry, LeaderboardResponse, LeaderboardStats,
    PlayerRankResponse, PlayerStatsSnapshot, RankHistory, RankHistoryEntry, Season,
    SeasonalLeaderboard,
};
use crate::middleware::cache::{keys as cache_keys, policies as cache_policies, ResponseCache};
use crate::realtime::leaderboard_broadcaster::{LeaderboardBroadcaster, RankObservation};
use chrono::{DateTime, Utc, Duration};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

pub struct LeaderboardService {
    db_pool: PgPool,
    /// Pushes rank changes to subscribed clients (Issue #900).
    ///
    /// Optional so the service stays constructible without the realtime stack —
    /// migrations, batch jobs and tests have no WebSocket clients to notify,
    /// and rank updates must not depend on Redis being reachable.
    broadcaster: Option<Arc<LeaderboardBroadcaster>>,
    /// Response cache for the read path (Issue #910).
    ///
    /// Optional for the same reason as `broadcaster`: the service must stay
    /// usable without Redis, and a cache that is absent simply means every
    /// read goes to Postgres, which is the behaviour this replaced.
    cache: Option<ResponseCache>,
}

impl LeaderboardService {
    pub fn new(db_pool: PgPool) -> Self {
        Self {
            db_pool,
            broadcaster: None,
            cache: None,
        }
    }

    /// Attaches the response cache to the leaderboard read path.
    pub fn with_cache(mut self, cache: ResponseCache) -> Self {
        self.cache = Some(cache);
        self
    }

    /// Attaches a broadcaster so rank updates are pushed in real time.
    pub fn with_broadcaster(mut self, broadcaster: Arc<LeaderboardBroadcaster>) -> Self {
        self.broadcaster = Some(broadcaster);
        self
    }

    /// Publishes a rank change, if a broadcaster is attached.
    ///
    /// Deliberately infallible: a client that misses a push re-syncs from the
    /// REST board, so a broadcast failure must never fail the rank update that
    /// has already been committed.
    async fn broadcast_rank(&self, category: &str, observation: RankObservation) {
        if let Some(broadcaster) = &self.broadcaster {
            broadcaster.publish_changes(category, &[observation]).await;
        }
    }

    /// Get leaderboard rankings for a category (optimized with single query)
    pub async fn get_leaderboard(
        &self,
        category: &str,
        limit: i64,
        offset: i64,
    ) -> Result<LeaderboardResponse, ApiError> {
        // Optimized: use window function to get count in same query.
        // Wrapped in `time_query` (#1084) — this endpoint is hit on every
        // leaderboard page load, so it's exactly the kind of query a
        // `db_query_duration_seconds{query_name="leaderboard.get_leaderboard"}`
        // P99 alert should watch.
        let entries = crate::metrics::time_query(
            "leaderboard.get_leaderboard",
            sqlx::query_as::<_, (Uuid, Uuid, String, Option<String>, i32, i32, i32, i32, i32, f64, String, DateTime<Utc>, i64)>(
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
            .fetch_all(&self.db_pool),
        )
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

        let response = LeaderboardResponse {
            entries: leaderboard_entries,
            total_count,
            period: "all_time".to_string(),
            category: category.to_string(),
        };

        if let Some(cache) = &self.cache {
            // Tagged by category so a single rank change drops every cached
            // page of that board at once, rather than leaving page 3 stale
            // while page 1 refreshes.
            cache
                .set(
                    &cache_keys::leaderboard(category, limit, offset),
                    &response,
                    cache_policies::LEADERBOARD,
                    &[cache_keys::leaderboard_tag(category)],
                )
                .await;
        }

        Ok(response)
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

        // The board just changed, so every cached page of it is wrong.
        if let Some(cache) = &self.cache {
            cache
                .invalidate_tags(&[
                    cache_keys::leaderboard_tag(category),
                    cache_keys::player_tag(&player_id),
                ])
                .await;
        }

        // Push the change to subscribed clients. The tracker drops it if the
        // rank did not actually move, so calling this unconditionally is free.
        self.broadcast_rank(
            category,
            RankObservation {
                user_id: player_id,
                ranking: new_ranking,
                elo_rating,
            },
        )
        .await;

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

        // A refresh is exactly the burst the per-player throttle holds back, so
        // flush once at the end rather than leaving the last change for each
        // player sitting until some unrelated update arrives.
        if let Some(broadcaster) = &self.broadcaster {
            broadcaster.flush(category).await;
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

    // ── Season close (#1075) ────────────────────────────────────────────────

    /// Close `season_id`: snapshot the top `top_n` leaderboard rows into
    /// `player_stats_snapshots`, decay every rated player of that game 10%
    /// toward the 1200 baseline (floor 800), and open the next season.
    pub async fn close_season(
        &self,
        season_id: Uuid,
        top_n: i64,
    ) -> Result<CloseSeasonResponse, ApiError> {
        let season = sqlx::query_as::<_, Season>("SELECT * FROM seasons WHERE id = $1")
            .bind(season_id)
            .fetch_optional(&self.db_pool)
            .await
            .map_err(|e| ApiError::DatabaseError(e))?
            .ok_or_else(|| ApiError::not_found("Season not found"))?;

        if season.status == "closed" {
            return Err(ApiError::conflict("Season is already closed"));
        }

        let top_rows = sqlx::query_as::<_, (Uuid, i32, i32, i32, i32)>(
            r#"
            SELECT user_id, ranking, elo_rating, matches_played, wins
            FROM leaderboards
            WHERE game = $1 AND period = 'all_time'
            ORDER BY ranking ASC
            LIMIT $2
            "#,
        )
        .bind(&season.game)
        .bind(top_n)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        for (user_id, ranking, elo_rating, matches_played, wins) in &top_rows {
            let losses = (*matches_played - *wins).max(0);
            sqlx::query(
                r#"
                INSERT INTO player_stats_snapshots
                    (season_id, user_id, game, rank, elo_rating, matches_played, wins, losses)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                "#,
            )
            .bind(season_id)
            .bind(user_id)
            .bind(&season.game)
            .bind(ranking)
            .bind(elo_rating)
            .bind(matches_played)
            .bind(wins)
            .bind(losses)
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::DatabaseError(e))?;
        }

        // Soft-reset every rated player of this game 10% toward the 1200
        // baseline (floor 800). Decayed in Rust via `decay_elo` (unit-tested
        // below) rather than in raw SQL, so the formula itself is verifiable
        // independent of a live database.
        let ratings = sqlx::query_as::<_, (Uuid, i32)>(
            "SELECT user_id, current_rating FROM user_elo WHERE game = $1",
        )
        .bind(&season.game)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let mut players_decayed = 0usize;
        for (user_id, current_rating) in &ratings {
            let new_rating = decay_elo(*current_rating);
            sqlx::query(
                "UPDATE user_elo SET current_rating = $1 WHERE game = $2 AND user_id = $3",
            )
            .bind(new_rating)
            .bind(&season.game)
            .bind(user_id)
            .execute(&self.db_pool)
            .await
            .map_err(|e| ApiError::DatabaseError(e))?;
            players_decayed += 1;
        }

        let closed_season = sqlx::query_as::<_, Season>(
            r#"
            UPDATE seasons SET status = 'closed', closed_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(season_id)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        let next_name = next_season_name(&season.name);
        let new_season = sqlx::query_as::<_, Season>(
            r#"
            INSERT INTO seasons (game, name, status, started_at)
            VALUES ($1, $2, 'active', NOW())
            RETURNING *
            "#,
        )
        .bind(&season.game)
        .bind(&next_name)
        .fetch_one(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))?;

        Ok(CloseSeasonResponse {
            closed_season,
            new_season,
            players_snapshotted: top_rows.len(),
            players_decayed,
        })
    }

    /// Historical leaderboard snapshot for a closed season (#1075).
    pub async fn get_season_history(
        &self,
        season_id: Uuid,
    ) -> Result<Vec<PlayerStatsSnapshot>, ApiError> {
        sqlx::query_as::<_, PlayerStatsSnapshot>(
            r#"
            SELECT * FROM player_stats_snapshots
            WHERE season_id = $1
            ORDER BY rank ASC
            "#,
        )
        .bind(season_id)
        .fetch_all(&self.db_pool)
        .await
        .map_err(|e| ApiError::DatabaseError(e))
    }
}

const ELO_BASELINE: f64 = 1200.0;
const ELO_DECAY_RATE: f64 = 0.10;
const ELO_MINIMUM: i32 = 800;

/// `new_elo = current_elo - (current_elo - 1200) * 0.10`, floored at 800
/// (#1075). A pure function so the decay math is unit-testable without a
/// live database.
fn decay_elo(current_rating: i32) -> i32 {
    let decayed = current_rating as f64 - (current_rating as f64 - ELO_BASELINE) * ELO_DECAY_RATE;
    (decayed.round() as i32).max(ELO_MINIMUM)
}

/// "Season 3" -> "Season 4"; falls back to appending " 2" when the name has
/// no trailing number to increment.
fn next_season_name(current: &str) -> String {
    let prefix = current.trim_end_matches(|c: char| c.is_ascii_digit());
    let digits = &current[prefix.len()..];
    match digits.parse::<u32>() {
        Ok(n) => format!("{prefix}{}", n + 1),
        Err(_) => format!("{current} 2"),
    }
}

#[cfg(test)]
mod season_close_tests {
    use super::{decay_elo, next_season_name, ELO_MINIMUM};

    #[test]
    fn increments_trailing_number() {
        assert_eq!(next_season_name("Season 3"), "Season 4");
        assert_eq!(next_season_name("S9"), "S10");
    }

    #[test]
    fn falls_back_when_no_trailing_number() {
        assert_eq!(next_season_name("Preseason"), "Preseason 2");
    }

    #[test]
    fn decays_ten_varied_ratings_toward_baseline() {
        // (current_rating, expected new_rating) for
        // new_elo = current - (current - 1200) * 0.10
        let cases: [(i32, i32); 10] = [
            (2400, 2280), // (2400 - 1200)*0.1 = 120 -> 2280
            (2000, 1920),
            (1800, 1740),
            (1600, 1560),
            (1400, 1380),
            (1200, 1200), // already at baseline: no change
            (1000, 1020), // below baseline decays *up* toward it
            (800, 840),
            (600, 800),   // (600-1200)*0.1 = -60 -> 660, but floor is 800
            (400, 800),   // (400-1200)*0.1 = -80 -> 480, but floor is 800
        ];

        for (current, expected) in cases {
            let actual = decay_elo(current);
            assert_eq!(
                actual, expected,
                "decay_elo({current}) = {actual}, expected {expected}"
            );
            assert!(actual >= ELO_MINIMUM, "decayed rating must never drop below {ELO_MINIMUM}");
        }
    }

    #[test]
    fn decay_never_drops_below_the_floor() {
        assert_eq!(decay_elo(0), ELO_MINIMUM);
        assert_eq!(decay_elo(-500), ELO_MINIMUM);
    }
}
