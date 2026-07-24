-- Migration: 20260601000001_matchmaking_perf_indexes
-- Description: Add composite indexes to matchmaking_queue to fix high-latency
--              queries that were doing full-table scans on (game, game_mode, status).

-- Composite index used by the background worker's active-game queries and by
-- the stats handler.  Replaces the separate (status) and (game, game_mode)
-- indexes for queries that filter on all three columns.
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_game_mode_status
    ON matchmaking_queue (game, game_mode, status);

-- Partial index for the common hot path: only waiting entries.
-- Keeps the index small and fast for the matchmaker worker.
-- status INTEGER: 0=waiting, 1=matched, 2=expired, 3=cancelled
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_waiting
    ON matchmaking_queue (game, game_mode, joined_at)
    WHERE status = 0;

-- Composite index for the average-wait-time aggregate query which filters on
-- (status = 1 (matched), matched_at IS NOT NULL, created_at >= ...).
CREATE INDEX IF NOT EXISTS idx_matchmaking_queue_matched_stats
    ON matchmaking_queue (game, game_mode, created_at)
    WHERE status = 1 AND matched_at IS NOT NULL;
