-- Revert 20261127000001_repair_backend_schema.

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
    END AS status
FROM api_keys ak
LEFT JOIN users u ON ak.user_id = u.id;

DROP TABLE IF EXISTS leaderboard_snapshots;

DROP TABLE IF EXISTS request_logs;
DROP TABLE IF EXISTS idempotency_configs;
DROP TABLE IF EXISTS idempotency_keys;

ALTER TABLE seasons DROP COLUMN IF EXISTS end_at;

ALTER TABLE user_elo DROP COLUMN IF EXISTS updated_at;
ALTER TABLE user_elo DROP COLUMN IF EXISTS created_at;

ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
