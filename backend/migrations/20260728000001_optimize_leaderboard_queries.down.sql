-- Rollback Optimize Leaderboard Queries — Issue #827

DROP INDEX IF EXISTS idx_leaderboards_history;
DROP INDEX IF EXISTS idx_leaderboards_user_game_period;
DROP INDEX IF EXISTS idx_matches_winner_game;
DROP INDEX IF EXISTS idx_matches_players_status;
DROP INDEX IF EXISTS idx_user_elo_game_rating;
DROP INDEX IF EXISTS idx_leaderboards_game_period_ranking;
