-- Migration: 20260824000001_player_stats_snapshots
-- Issue #904 — Player statistics aggregation
--
-- Adds a pre-computed daily snapshot cache table so the /stats/player/{id}/daily
-- endpoint stays fast at scale without re-scanning elo_history every request.
-- The table is populated by a nightly cron job or on-demand refresh.

CREATE TABLE IF NOT EXISTS player_stats_daily (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    snapshot_date    TIMESTAMPTZ NOT NULL,   -- UTC midnight of the day
    game_mode        VARCHAR(50) NOT NULL,
    wins             BIGINT      NOT NULL DEFAULT 0,
    losses           BIGINT      NOT NULL DEFAULT 0,
    draws            BIGINT      NOT NULL DEFAULT 0,
    matches_played   BIGINT      NOT NULL DEFAULT 0,
    win_rate_pct     DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    avg_session_secs BIGINT      NOT NULL DEFAULT 0,
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, snapshot_date, game_mode)
);

CREATE INDEX IF NOT EXISTS idx_psd_user_date
    ON player_stats_daily (user_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_psd_user_mode
    ON player_stats_daily (user_id, game_mode);

COMMENT ON TABLE player_stats_daily IS
    'Pre-computed daily win/loss/draw snapshots per player per game mode. '
    'Populated nightly; used by GET /api/stats/player/{id}/daily for fast reads.';
