-- Rollback: 20260601000001_matchmaking_perf_indexes

DROP INDEX IF EXISTS idx_matchmaking_queue_matched_stats;
DROP INDEX IF EXISTS idx_matchmaking_queue_waiting;
DROP INDEX IF EXISTS idx_matchmaking_queue_game_mode_status;
