-- Idempotency Keys Table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(255) NOT NULL UNIQUE,
    request_hash VARCHAR(64) NOT NULL,
    response_status SMALLINT NOT NULL,
    response_headers JSONB,
    response_body JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    request_method VARCHAR(10),
    request_path TEXT,
    request_user_agent TEXT,
    request_ip_address INET
);

-- Idempotency Configuration Table
CREATE TABLE IF NOT EXISTS idempotency_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_pattern TEXT NOT NULL UNIQUE,
    enabled BOOLEAN NOT NULL DEFAULT true,
    ttl_seconds INTEGER NOT NULL DEFAULT 86400,
    max_response_size_kb INTEGER NOT NULL DEFAULT 1024,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Request Logs Table (for debugging and analytics)
CREATE TABLE IF NOT EXISTS request_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(255) REFERENCES idempotency_keys(key) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    method VARCHAR(10) NOT NULL,
    path TEXT NOT NULL,
    query_params TEXT,
    headers JSONB,
    body_hash VARCHAR(64),
    response_status SMALLINT,
    response_size_bytes INTEGER,
    processing_time_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    client_ip INET,
    user_agent TEXT
);

-- Create Indexes for Performance

-- Idempotency Keys Indexes
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key ON idempotency_keys(key);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_used_at ON idempotency_keys(used_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user_id ON idempotency_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_request_hash ON idempotency_keys(request_hash);

-- Idempotency Configs Indexes
CREATE INDEX IF NOT EXISTS idx_idempotency_configs_route_pattern ON idempotency_configs(route_pattern);
CREATE INDEX IF NOT EXISTS idx_idempotency_configs_enabled ON idempotency_configs(enabled);

-- Request Logs Indexes
CREATE INDEX IF NOT EXISTS idx_request_logs_idempotency_key ON request_logs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_request_logs_user_id ON request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_method_path ON request_logs(method, path);
CREATE INDEX IF NOT EXISTS idx_request_logs_response_status ON request_logs(response_status);

-- Create Composite Indexes for Common Queries
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_key_expires ON idempotency_keys(key, expires_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_user_created ON request_logs(user_id, created_at DESC);

-- Create Views for Analytics

-- View for active idempotency keys
CREATE OR REPLACE VIEW active_idempotency_keys AS
SELECT 
    ik.*,
    CASE 
        WHEN ik.used_at IS NULL THEN 'pending'
        WHEN ik.expires_at <= NOW() THEN 'expired'
        ELSE 'used'
    END as status,
    EXTRACT(EPOCH FROM (ik.expires_at - NOW()))::INTEGER as seconds_until_expiry
FROM idempotency_keys ik
WHERE ik.expires_at > NOW()
ORDER BY ik.created_at DESC;

-- View for idempotency usage statistics
CREATE OR REPLACE VIEW idempotency_usage_stats AS
SELECT 
    DATE_TRUNC('hour', created_at) as hour,
    COUNT(*) as total_keys,
    COUNT(CASE WHEN used_at IS NOT NULL THEN 1 END) as used_keys,
    COUNT(CASE WHEN used_at IS NULL THEN 1 END) as unused_keys,
    AVG(EXTRACT(EPOCH FROM (used_at - created_at)))::INTEGER as avg_time_to_use_seconds
FROM idempotency_keys
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

-- View for conflict detection
CREATE OR REPLACE VIEW idempotency_conflicts AS
SELECT 
    key,
    COUNT(*) as usage_count,
    MIN(created_at) as first_used,
    MAX(created_at) as last_used,
    COUNT(DISTINCT request_hash) as unique_hashes,
    CASE 
        WHEN COUNT(DISTINCT request_hash) > 1 THEN true 
        ELSE false 
    END as has_conflict
FROM idempotency_keys
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY key
HAVING COUNT(*) > 1
ORDER BY usage_count DESC, has_conflict DESC;

-- View for route-specific statistics
CREATE OR REPLACE VIEW route_idempotency_stats AS
SELECT 
    rl.path,
    COUNT(*) as total_requests,
    COUNT(DISTINCT rl.idempotency_key) as unique_keys,
    COUNT(DISTINCT rl.user_id) as unique_users,
    AVG(rl.processing_time_ms)::INTEGER as avg_processing_time_ms,
    COUNT(CASE WHEN rl.response_status >= 400 THEN 1 END) as error_count,
    COUNT(CASE WHEN ik.key IS NOT NULL THEN 1 END) as idempotent_requests
FROM request_logs rl
LEFT JOIN idempotency_keys ik ON rl.idempotency_key = ik.key
WHERE rl.created_at >= NOW() - INTERVAL '24 hours'
GROUP BY rl.path
ORDER BY total_requests DESC;

-- Create Functions for Utility Operations

-- Function to clean up expired keys
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS INTEGER AS $$
DECLARE
    cleaned_count INTEGER;
BEGIN
    DELETE FROM idempotency_keys 
    WHERE expires_at <= NOW()
    AND used_at IS NOT NULL;
    
    GET DIAGNOSTICS cleaned_count = ROW_COUNT;
    
    -- Also clean up old unused keys (older than 1 hour)
    DELETE FROM idempotency_keys 
    WHERE used_at IS NULL 
    AND created_at < NOW() - INTERVAL '1 hour';
    
    GET DIAGNOSTICS cleaned_count = cleaned_count + ROW_COUNT;
    
    RETURN cleaned_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get idempotency key statistics
CREATE OR REPLACE FUNCTION get_idempotency_stats(
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW() - INTERVAL '24 hours',
    end_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
)
RETURNS TABLE(
    total_keys BIGINT,
    active_keys BIGINT,
    used_keys BIGINT,
    conflicts_detected BIGINT,
    avg_ttl_seconds NUMERIC,
    cache_hit_rate NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_keys,
        COUNT(CASE WHEN expires_at > NOW() THEN 1 END) as active_keys,
        COUNT(CASE WHEN used_at IS NOT NULL THEN 1 END) as used_keys,
        (SELECT COUNT(*) FROM idempotency_conflicts WHERE has_conflict = true) as conflicts_detected,
        AVG(EXTRACT(EPOCH FROM (expires_at - created_at))) as avg_ttl_seconds,
        CASE 
            WHEN COUNT(*) > 0 THEN 
                COUNT(CASE WHEN used_at IS NOT NULL THEN 1 END)::NUMERIC / COUNT(*)::NUMERIC 
            ELSE 0 
        END as cache_hit_rate
    FROM idempotency_keys
    WHERE created_at BETWEEN start_time AND end_time;
END;
$$ LANGUAGE plpgsql;

-- Function to validate idempotency key format
CREATE OR REPLACE FUNCTION validate_idempotency_key(key TEXT)
RETURNS TABLE(
    is_valid BOOLEAN,
    error_message TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        CASE 
            WHEN length(key) < 8 THEN false
            WHEN length(key) > 255 THEN false
            WHEN key !~ '^[a-zA-Z0-9_-]+$' THEN false
            ELSE true
        END as is_valid,
        CASE 
            WHEN length(key) < 8 THEN 'Key must be at least 8 characters'
            WHEN length(key) > 255 THEN 'Key must be less than 255 characters'
            WHEN key !~ '^[a-zA-Z0-9_-]+$' THEN 'Key can only contain alphanumeric characters, hyphens, and underscores'
            ELSE NULL
        END as error_message;
END;
$$ LANGUAGE plpgsql;

-- Create Triggers for Data Integrity

-- Trigger to update updated_at timestamp on configs
CREATE OR REPLACE FUNCTION update_idempotency_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to configs table
DROP TRIGGER IF EXISTS update_idempotency_config_updated_at ON idempotency_configs;
CREATE TRIGGER update_idempotency_config_updated_at 
    BEFORE UPDATE ON idempotency_configs 
    FOR EACH ROW EXECUTE FUNCTION update_idempotency_config_updated_at();

-- Create Trigger for Request Logging
CREATE OR REPLACE FUNCTION log_idempotency_request()
RETURNS TRIGGER AS $$
BEGIN
    -- Log the request when an idempotency key is first used
    IF NEW.used_at IS NOT NULL AND OLD.used_at IS NULL THEN
        INSERT INTO request_logs (
            idempotency_key, 
            method, 
            path, 
            response_status,
            created_at
        ) VALUES (
            NEW.key,
            NEW.request_method,
            NEW.request_path,
            NEW.response_status,
            NEW.created_at
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to idempotency keys
DROP TRIGGER IF EXISTS log_idempotency_request ON idempotency_keys;
CREATE TRIGGER log_idempotency_request 
    AFTER UPDATE ON idempotency_keys 
    FOR EACH ROW EXECUTE FUNCTION log_idempotency_request();

-- Insert Default Configurations
INSERT INTO idempotency_configs (route_pattern, enabled, ttl_seconds, max_response_size_kb) VALUES
('/api/payments/create', true, 86400, 1024),
('/api/payments/refund', true, 86400, 1024),
('/api/wallets/deposit', true, 86400, 512),
('/api/wallets/withdraw', true, 86400, 512),
('/api/tournaments/join', true, 86400, 256),
('/api/matchmaking/join', true, 3600, 256),  -- 1 hour TTL for matchmaking
('/api/payments/create', true, 86400, 1024)
ON CONFLICT (route_pattern) DO NOTHING;

-- Create Comments for Documentation
COMMENT ON TABLE idempotency_keys IS 'Stores idempotency keys and cached responses to prevent duplicate operations';
COMMENT ON TABLE idempotency_configs IS 'Configuration for idempotency behavior per route';
COMMENT ON TABLE request_logs IS 'Logs all requests for debugging and analytics';

COMMENT ON COLUMN idempotency_keys.key IS 'Unique idempotency key provided by client';
COMMENT ON COLUMN idempotency_keys.request_hash IS 'SHA256 hash of request method, path, headers, and body';
COMMENT ON COLUMN idempotency_keys.response_status IS 'HTTP status code of cached response';
COMMENT ON COLUMN idempotency_keys.response_headers IS 'JSON representation of response headers';
COMMENT ON COLUMN idempotency_keys.response_body IS 'JSON representation of response body';
COMMENT ON COLUMN idempotency_keys.expires_at IS 'When the key expires and can be cleaned up';
COMMENT ON COLUMN idempotency_keys.used_at IS 'When the key was first used';

-- Create Partition for Request Logs (optional for high volume)
-- This would be useful if you expect very high request volumes
-- CREATE TABLE request_logs_y2024m01 PARTITION OF request_logs
-- FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
