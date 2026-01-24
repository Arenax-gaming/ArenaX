-- Rollback ArenaX Device Management Schema
-- Migration: 20240928000003_create_devices
-- Description: Drops device management tables and related objects

-- Drop trigger
DROP TRIGGER IF EXISTS update_devices_updated_at ON devices;

-- Drop device security alerts table
DROP TABLE IF EXISTS device_security_alerts CASCADE;

-- Drop devices table
DROP TABLE IF EXISTS devices CASCADE;

-- Drop device_type enum
DROP TYPE IF EXISTS device_type CASCADE;
