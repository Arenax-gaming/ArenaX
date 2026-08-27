-- Feature toggle management system (#948)
-- Remote flag configuration, per-user overrides, percentage rollout,
-- sticky A/B assignments, and evaluation analytics.

CREATE TABLE IF NOT EXISTS feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_key VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    enabled BOOLEAN NOT NULL DEFAULT false,
    rollout_percentage INTEGER NOT NULL DEFAULT 0
        CHECK (rollout_percentage BETWEEN 0 AND 100),
    -- Weighted A/B variants, e.g. {"control": 50, "treatment": 50}.
    -- Empty object means a boolean on/off flag with no named variants.
    variants JSONB NOT NULL DEFAULT '{}'::jsonb,
    default_variant VARCHAR(50),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feature_flags_enabled_idx
    ON feature_flags (enabled);
CREATE INDEX IF NOT EXISTS feature_flags_created_at_idx
    ON feature_flags (created_at DESC);

CREATE TABLE IF NOT EXISTS feature_flag_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_id UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL,
    variant VARCHAR(50),
    reason TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE (flag_id, user_id)
);

CREATE INDEX IF NOT EXISTS feature_flag_overrides_user_id_idx
    ON feature_flag_overrides (user_id);
CREATE INDEX IF NOT EXISTS feature_flag_overrides_expires_at_idx
    ON feature_flag_overrides (expires_at)
    WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS feature_flag_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_id UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    variant VARCHAR(50) NOT NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (flag_id, user_id)
);

CREATE INDEX IF NOT EXISTS feature_flag_assignments_user_id_idx
    ON feature_flag_assignments (user_id);

CREATE TABLE IF NOT EXISTS feature_flag_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flag_id UUID NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    flag_key VARCHAR(100) NOT NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    event_name VARCHAR(100) NOT NULL,
    enabled BOOLEAN NOT NULL,
    variant VARCHAR(50),
    reason VARCHAR(40) NOT NULL,
    properties JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feature_flag_events_flag_key_created_idx
    ON feature_flag_events (flag_key, created_at DESC);
CREATE INDEX IF NOT EXISTS feature_flag_events_flag_id_idx
    ON feature_flag_events (flag_id);
CREATE INDEX IF NOT EXISTS feature_flag_events_user_id_idx
    ON feature_flag_events (user_id)
    WHERE user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION update_feature_flags_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_feature_flags_updated_at_trig ON feature_flags;
CREATE TRIGGER update_feature_flags_updated_at_trig
    BEFORE UPDATE ON feature_flags
    FOR EACH ROW
    EXECUTE FUNCTION update_feature_flags_updated_at();
