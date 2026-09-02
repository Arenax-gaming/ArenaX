-- Drop feature toggle management system

DROP TRIGGER IF EXISTS update_feature_flags_updated_at_trig ON feature_flags;
DROP FUNCTION IF EXISTS update_feature_flags_updated_at();

DROP TABLE IF EXISTS feature_flag_events;
DROP TABLE IF EXISTS feature_flag_assignments;
DROP TABLE IF EXISTS feature_flag_overrides;
DROP TABLE IF EXISTS feature_flags;
