-- Drop API Key Rotation System

DROP TRIGGER IF EXISTS update_api_keys_updated_at_trig ON api_keys;

DROP FUNCTION IF EXISTS update_api_keys_updated_at();

DROP VIEW IF EXISTS api_key_summaries;

DROP TABLE IF EXISTS api_key_rotation_history;

DROP TABLE IF EXISTS api_key_usage_logs;

DROP TABLE IF EXISTS api_keys;