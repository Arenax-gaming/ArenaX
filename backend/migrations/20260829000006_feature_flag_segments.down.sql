-- Drop user segment targeting from feature flags (#1082)

ALTER TABLE users
    DROP COLUMN IF EXISTS is_beta_tester;

ALTER TABLE feature_flags
    DROP COLUMN IF EXISTS target_segments;
