-- Revert zero-downtime API key rotation overlap (Issue #1080)

-- Restore the original summary view (without the overlap fields).
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
    u.username AS created_by_username,
    u.email AS created_by_email,
    CASE
        WHEN ak.is_active = false THEN 'revoked'
        WHEN ak.expiration_date IS NOT NULL AND ak.expiration_date < NOW() THEN 'expired'
        WHEN ak.max_uses IS NOT NULL AND ak.use_count >= ak.max_uses THEN 'max_uses_exceeded'
        WHEN ak.rotation_enabled = true AND ak.next_rotation_date IS NOT NULL AND ak.next_rotation_date < NOW() THEN 'rotation_due'
        ELSE 'active'
    END AS status
FROM api_keys ak
LEFT JOIN users u ON ak.user_id = u.id;

DROP INDEX IF EXISTS idx_api_keys_old_key_hash;
DROP INDEX IF EXISTS idx_api_keys_old_key_expires_at;

ALTER TABLE api_keys
DROP COLUMN IF EXISTS webhook_url,
DROP COLUMN IF EXISTS old_key_expires_at,
DROP COLUMN IF EXISTS old_key_hash,
DROP COLUMN IF EXISTS overlap_duration_seconds;