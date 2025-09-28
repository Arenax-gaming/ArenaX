-- ArenaX Development Database Initialization
-- This script sets up the development environment for the ArenaX backend

-- Create additional development extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create development-specific indexes for better performance
-- These will be created after migrations run

-- Create development roles and permissions
DO $$
BEGIN
    -- Create read-only role for development
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'arenax_readonly') THEN
        CREATE ROLE arenax_readonly WITH LOGIN PASSWORD 'readonly';
    END IF;

    -- Create analytics role for data analysis
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'arenax_analytics') THEN
        CREATE ROLE arenax_analytics WITH LOGIN PASSWORD 'analytics';
    END IF;
END
$$;

-- Set up logging for development
-- These settings help with debugging and performance tuning
ALTER SYSTEM SET log_statement = 'mod';
ALTER SYSTEM SET log_min_duration_statement = 100;
ALTER SYSTEM SET log_checkpoints = on;
ALTER SYSTEM SET log_connections = on;
ALTER SYSTEM SET log_disconnections = on;
ALTER SYSTEM SET log_lock_waits = on;

-- Reload configuration
SELECT pg_reload_conf();

-- Grant permissions after the main schema is created
-- Note: This will be executed by the database triggers after migrations
CREATE OR REPLACE FUNCTION grant_development_permissions()
RETURNS void AS $$
BEGIN
    -- Grant read permissions to readonly role
    GRANT USAGE ON SCHEMA public TO arenax_readonly;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO arenax_readonly;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO arenax_readonly;

    -- Grant analytics permissions
    GRANT USAGE ON SCHEMA public TO arenax_analytics;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO arenax_analytics;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO arenax_analytics;

    RAISE NOTICE 'Development permissions granted successfully';
END;
$$ LANGUAGE plpgsql;

-- Create a function to setup development data after migrations
CREATE OR REPLACE FUNCTION setup_development_environment()
RETURNS void AS $$
BEGIN
    -- This function will be called after migrations are complete
    PERFORM grant_development_permissions();

    -- Add any other development-specific setup here
    RAISE NOTICE 'Development environment setup completed';
END;
$$ LANGUAGE plpgsql;

-- Display information about the database setup
SELECT
    'ArenaX Development Database Initialized' as message,
    current_database() as database_name,
    current_user as current_user,
    now() as initialized_at;
