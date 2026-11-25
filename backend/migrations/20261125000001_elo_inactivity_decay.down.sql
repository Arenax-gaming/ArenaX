-- Rollback ELO inactivity decay tracking columns and index (Issue #1533).

DROP INDEX IF EXISTS idx_user_elo_pending_decay_notify;
DROP INDEX IF EXISTS idx_user_elo_inactivity_decay;

ALTER TABLE user_elo
    DROP COLUMN IF EXISTS decay_notified,
    DROP COLUMN IF EXISTS decay_intervals_applied,
    DROP COLUMN IF EXISTS last_decay_at,
    DROP COLUMN IF EXISTS last_ranked_match_at;
