-- Add user segment targeting to feature flags (#1082)

ALTER TABLE feature_flags
    ADD COLUMN IF NOT EXISTS target_segments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_beta_tester BOOLEAN NOT NULL DEFAULT false;
