-- Database-backed anti-cheat rule configuration (Issue #1525).
--
-- Thresholds used to be compiled into the gameplay analysis service, so
-- changing one required a deploy. They now live in these two tables: admins
-- update them through PATCH /admin/anti-cheat/rules and every backend instance
-- refreshes its in-memory cache within 60 seconds.

CREATE TABLE IF NOT EXISTS anti_cheat_settings (
    id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    flag_threshold SMALLINT NOT NULL CHECK (flag_threshold BETWEEN 0 AND 100),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anti_cheat_rules (
    name       VARCHAR(64) PRIMARY KEY,
    weight     SMALLINT NOT NULL CHECK (weight BETWEEN 0 AND 100),
    threshold  INTEGER NOT NULL CHECK (threshold >= 0),
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the values that were previously hardcoded, so behaviour does not
-- change until an admin edits a rule.
INSERT INTO anti_cheat_settings (id, flag_threshold)
VALUES (TRUE, 70)
ON CONFLICT (id) DO NOTHING;

INSERT INTO anti_cheat_rules (name, weight, threshold, enabled)
VALUES
    ('reaction_inhuman', 50, 50,    TRUE),
    ('reaction_fast',    30, 90,    TRUE),
    ('accuracy_extreme', 25, 9500,  TRUE),
    ('accuracy_high',    15, 8500,  TRUE),
    ('snap_extreme',     35, 1440,  TRUE),
    ('snap_fast',        20, 720,   TRUE),
    ('speed_hack',       40, 0,     TRUE),
    ('input_scripted',   15, 500,   TRUE)
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION anti_cheat_rules_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_anti_cheat_rules_updated_at ON anti_cheat_rules;
CREATE TRIGGER trg_anti_cheat_rules_updated_at
    BEFORE UPDATE ON anti_cheat_rules
    FOR EACH ROW
    EXECUTE FUNCTION anti_cheat_rules_touch_updated_at();

DROP TRIGGER IF EXISTS trg_anti_cheat_settings_updated_at ON anti_cheat_settings;
CREATE TRIGGER trg_anti_cheat_settings_updated_at
    BEFORE UPDATE ON anti_cheat_settings
    FOR EACH ROW
    EXECUTE FUNCTION anti_cheat_rules_touch_updated_at();

COMMENT ON TABLE anti_cheat_rules IS
    'Runtime-editable anti-cheat detection rules (weight + threshold per rule)';
COMMENT ON TABLE anti_cheat_settings IS
    'Singleton anti-cheat settings: composite score at which a session is flagged';
