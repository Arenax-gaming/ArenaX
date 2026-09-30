-- Zero-downtime API key rotation (Issue #1080)
--
-- Extends the api_keys table with an overlap window so third-party
-- integrations that have not yet adopted the rotated key keep working until
-- `old_key_expires_at` passes:
--   * `POST /api/api-keys/:id/rotate` sets `old_key_expires_at = now() +
--     overlap_duration_seconds` on the previous key instead of deactivating it.
--   * Both the old and the new key are accepted during the overlap period.
--   * A background job expires old keys once `old_key_expires_at` passes.
--
-- `overlap_duration_seconds` is configurable per key (default 24h, max 7 days,
-- enforced in the service layer).

ALTER TABLE api_keys
ADD COLUMN IF NOT EXISTS overlap_duration_seconds BIGINT NOT NULL DEFAULT 86400,
ADD COLUMN IF NOT EXISTS old_key_hash VARCHAR(255),
ADD COLUMN IF NOT EXISTS old_key_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS webhook_url TEXT;

CREATE INDEX IF NOT EXISTS idx_api_keys_old_key_hash ON api_keys(old_key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_old_key_expires_at
    ON api_keys(old_key_expires_at)
    WHERE old_key_expires_at IS NOT NULL AND is_active = true;

-- Extend the summary view so `GET /api/api-keys/:id` can expose the overlap
-- deadline (`old_key_expires_at`) and a `key_preview` for integrators.
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
    LEFT(ak.key, 8) AS key_preview,
    u.username AS created_by_username,
    u.email AS created_by_email,
    CASE
        WHEN ak.is_active = false THEN 'revoked'
        WHEN ak.old_key_expires_at IS NOT NULL AND ak.old_key_expires_at < NOW() THEN 'expired'
        WHEN ak.expiration_date IS NOT NULL AND ak.expiration_date < NOW() THEN 'expired'
        WHEN ak.max_uses IS NOT NULL AND ak.use_count >= ak.max_uses THEN 'max_uses_exceeded'
        WHEN ak.rotation_enabled = true AND ak.next_rotation_date IS NOT NULL AND ak.next_rotation_date < NOW() THEN 'rotation_due'
        ELSE 'active'
    END AS status
FROM api_keys ak
LEFT JOIN users u ON ak.user_id = u.id;

COMMENT ON COLUMN api_keys.old_key_expires_at IS 'Deadline until which the previous (rotated) key remains valid during zero-downtime rotation.';
COMMENT ON COLUMN api_keys.overlap_duration_seconds IS 'Overlap window (seconds) during which both old and new key are accepted after rotation. Default 24h, max 7 days.';
COMMENT ON COLUMN api_keys.webhook_url IS 'Registered callback URL notified when rotation is initiated and when the old key expires.';