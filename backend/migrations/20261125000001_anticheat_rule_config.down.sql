-- Revert database-backed anti-cheat rule configuration (Issue #1525).

DROP TRIGGER IF EXISTS trg_anti_cheat_settings_updated_at ON anti_cheat_settings;
DROP TRIGGER IF EXISTS trg_anti_cheat_rules_updated_at ON anti_cheat_rules;
DROP FUNCTION IF EXISTS anti_cheat_rules_touch_updated_at();
DROP TABLE IF EXISTS anti_cheat_rules;
DROP TABLE IF EXISTS anti_cheat_settings;
