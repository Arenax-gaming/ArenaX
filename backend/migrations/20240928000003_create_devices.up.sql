-- ArenaX Device Management Schema
-- Migration: 20240928000003_create_devices
-- Description: Creates device management tables for multi-device authentication and security monitoring

-- Create device_type enum
CREATE TYPE device_type AS ENUM ('desktop', 'mobile', 'tablet', 'unknown');

-- Create devices table
CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fingerprint VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    device_type device_type NOT NULL DEFAULT 'unknown',
    platform VARCHAR(100) NOT NULL,
    os VARCHAR(100) NOT NULL,
    browser VARCHAR(100),
    ip_address VARCHAR(45) NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_trusted BOOLEAN NOT NULL DEFAULT false,
    is_blocked BOOLEAN NOT NULL DEFAULT false,
    login_count BIGINT NOT NULL DEFAULT 0,
    failed_login_count BIGINT NOT NULL DEFAULT 0,
    last_login TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_devices_user_id ON devices(user_id);
CREATE INDEX idx_devices_fingerprint ON devices(fingerprint);
CREATE INDEX idx_devices_user_fingerprint ON devices(user_id, fingerprint);
CREATE INDEX idx_devices_last_seen ON devices(last_seen);
CREATE INDEX idx_devices_is_active ON devices(is_active);
CREATE INDEX idx_devices_is_blocked ON devices(is_blocked);

-- Create device_security_alerts table
CREATE TABLE device_security_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for security alerts
CREATE INDEX idx_device_security_alerts_device_id ON device_security_alerts(device_id);
CREATE INDEX idx_device_security_alerts_user_id ON device_security_alerts(user_id);
CREATE INDEX idx_device_security_alerts_created_at ON device_security_alerts(created_at);
CREATE INDEX idx_device_security_alerts_severity ON device_security_alerts(severity);

-- Create function to update updated_at timestamp (if not already exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
