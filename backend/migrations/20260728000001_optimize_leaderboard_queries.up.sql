-- Optimize Leaderboard Queries — Issue #827
-- Add indexes to improve query performance for leaderboard endpoints

-- Index for leaderboard queries filtering by game and period
CREATE INDEX IF NOT EXISTS idx_leaderboards_game_period_ranking 
ON leaderboards(game, period, ranking) 
WHERE period IN ('all_time', 'weekly', 'monthly');

-- Index for user_elo queries to optimize ranking calculations
CREATE INDEX IF NOT EXISTS idx_user_elo_game_rating 
ON user_elo(game, current_rating DESC);

-- Index for matches queries to optimize player stats calculations
CREATE INDEX IF NOT EXISTS idx_matches_players_status 
ON matches(player1_id, player2_id, game_mode, status) 
WHERE status = 3;

-- Separate index for winner lookups
CREATE INDEX IF NOT EXISTS idx_matches_winner_game 
ON matches(winner_id, game_mode, status) 
WHERE status = 3;

-- Composite index for leaderboard user lookups
CREATE INDEX IF NOT EXISTS idx_leaderboards_user_game_period 
ON leaderboards(user_id, game, period);

-- Index for rank history queries
CREATE INDEX IF NOT EXISTS idx_leaderboards_history 
ON leaderboards(user_id, game, updated_at DESC) 
WHERE updated_at > NOW() - INTERVAL '90 days';

-- Add statistics for query planner optimization
ANALYZE leaderboards;
ANALYZE user_elo;
ANALYZE matches;
ANALYZE users;
