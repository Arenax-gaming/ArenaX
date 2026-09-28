-- API Key Rotation System
-- Creates tables for structured API key management with rotation, permissions, and usage tracking

-- API Keys Table
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_type VARCHAR(20) NOT NULL DEFAULT 'api_key',
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expiration_date TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    revoked_by UUID REFERENCES users(id),
    rotation_enabled BOOLEAN NOT NULL DEFAULT false,
    rotation_interval INTERVAL,
    next_rotation_date TIMESTAMP WITH TIME ZONE,
    max_uses INTEGER,
    use_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- API Key Usage Logs Table
CREATE TABLE IF NOT EXISTS api_key_usage_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    endpoint VARCHAR(255) NOT NULL,
    method VARCHAR(10) NOT NULL,
    client_ip INET,
    user_agent TEXT,
    response_status INTEGER,
    request_duration_ms INTEGER,
    scopes_used TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- API Key Rotation History Table
CREATE TABLE IF NOT EXISTS api_key_rotation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    old_key_hash VARCHAR(255) NOT NULL,
    new_key_hash VARCHAR(255) NOT NULL,
    rotated_by UUID REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_is_active_idx ON api_keys(is_active);
CREATE INDEX IF NOT EXISTS api_keys_expiration_date_idx ON api_keys(expiration_date);
CREATE INDEX IF NOT EXISTS api_keys_last_used_at_idx ON api_keys(last_used_at);
CREATE INDEX IF NOT EXISTS api_key_usage_logs_api_key_id_idx ON api_key_usage_logs(api_key_id);
CREATE INDEX IF NOT EXISTS api_key_usage_logs_created_at_idx ON api_key_usage_logs(created_at);

-- View: API Key Summary
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

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update updated_at on row update
DROP TRIGGER IF EXISTS update_api_keys_updated_at_trig ON api_keys;
CREATE TRIGGER update_api_keys_updated_at_trig
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_api_keys_updated_at();