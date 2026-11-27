-- Repair schema drift between the backend source and the migration history.
--
-- Several features were merged with the queries but without the schema they
-- depend on, so `sqlx::query!` (which type-checks every statement against a
-- live, migrated database) failed at compile time. This migration adds the
-- missing pieces instead of weakening those compile-time checks:
--
--   * users.password_hash          — auth_service registration/login
--   * user_elo created_at/updated_at — matchmaking ELO upserts
--   * seasons.end_at               — season-close snapshot job
--   * idempotency_keys/_configs + request_logs — idempotency framework
--   * leaderboard_snapshots        — archived season standings
--   * api_key_summaries.user_id    — per-user API key lookups
--
-- Every statement is idempotent so re-running against a database that
-- already contains part of this schema is safe.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

ALTER TABLE user_elo ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_elo ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE seasons ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ;

-- ── Idempotency framework ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key                 VARCHAR(255) NOT NULL UNIQUE,
    request_hash        VARCHAR(64) NOT NULL,
    response_status     SMALLINT NOT NULL,
    response_headers    JSONB,
    response_body       JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    used_at             TIMESTAMPTZ,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    request_method      VARCHAR(10),
    request_path        TEXT,
    request_user_agent  TEXT,
    request_ip_address  INET
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key ON idempotency_keys(key);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user_id ON idempotency_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key_expires ON idempotency_keys(key, expires_at);

CREATE TABLE IF NOT EXISTS idempotency_configs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_pattern       TEXT NOT NULL UNIQUE,
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    ttl_seconds         INTEGER NOT NULL DEFAULT 86400,
    max_response_size_kb INTEGER NOT NULL DEFAULT 1024,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_configs_enabled ON idempotency_configs(enabled);

CREATE TABLE IF NOT EXISTS request_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key     VARCHAR(255) REFERENCES idempotency_keys(key) ON DELETE SET NULL,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    method              VARCHAR(10) NOT NULL,
    path                TEXT NOT NULL,
    query_params        TEXT,
    headers             JSONB,
    body_hash           VARCHAR(64),
    response_status     SMALLINT,
    response_size_bytes INTEGER,
    processing_time_ms  INTEGER,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    client_ip           INET,
    user_agent          TEXT
);

CREATE INDEX IF NOT EXISTS idx_request_logs_idempotency_key ON request_logs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_request_logs_user_id ON request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at);

-- ── Archived season standings ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id              UUID PRIMARY KEY,
    season_id       UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    season_name     VARCHAR(100) NOT NULL,
    game            VARCHAR(50) NOT NULL,
    user_id         UUID,
    rank            INTEGER NOT NULL,
    elo_rating      INTEGER NOT NULL,
    matches_played  INTEGER NOT NULL DEFAULT 0,
    wins            INTEGER NOT NULL DEFAULT 0,
    losses          INTEGER NOT NULL DEFAULT 0,
    snapshotted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per player per season: the snapshot job inserts with
-- `ON CONFLICT DO NOTHING` so a re-run can never overwrite an archived season.
CREATE UNIQUE INDEX IF NOT EXISTS uq_leaderboard_snapshots_season_user
    ON leaderboard_snapshots(season_id, user_id);
CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_season_rank
    ON leaderboard_snapshots(season_id, rank);

-- ── API key summaries ────────────────────────────────────────────────────────
-- The summary queries filter by `id AND user_id`, so the view must expose the
-- owner. `CREATE OR REPLACE VIEW` can only append columns, and `user_id` is
-- added last on purpose.
CREATE OR REPLACE VIEW api_key_summaries AS
SELECT
    ak.id,
    ak.name,
    ak.description,
    ak.key_type,
    ak.scopes,
    ak.is_active,
    ak.expiration_date,
    ak.created_at,
    ak.last_used_at,
    ak.use_count,
    ak.max_uses,
    ak.rotation_enabled,
    ak.next_rotation_date,
    ak.old_key_expires_at,
    ak.overlap_duration_seconds,
    ak.webhook_url,
    left(ak.key::text, 8) AS key_preview,
    u.username AS created_by_username,
    u.email AS created_by_email,
    CASE
        WHEN ak.is_active = false THEN 'revoked'::text
        WHEN ak.old_key_expires_at IS NOT NULL AND ak.old_key_expires_at < now() THEN 'expired'::text
        WHEN ak.expiration_date IS NOT NULL AND ak.expiration_date < now() THEN 'expired'::text
        WHEN ak.max_uses IS NOT NULL AND ak.use_count >= ak.max_uses THEN 'max_uses_exceeded'::text
        WHEN ak.rotation_enabled = true AND ak.next_rotation_date IS NOT NULL AND ak.next_rotation_date < now() THEN 'rotation_due'::text
        ELSE 'active'::text
    END AS status,
    ak.user_id
FROM api_keys ak
LEFT JOIN users u ON ak.user_id = u.id;
