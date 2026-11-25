-- Track ranked-match inactivity and ELO decay state per (user_id, game) (Issue #1533).
--
-- Separating `last_ranked_match_at` from `last_updated` ensures periodic decay
-- updates and seasonal soft-resets never accidentally reset a player's
-- inactivity clock.

ALTER TABLE user_elo
    ADD COLUMN IF NOT EXISTS last_ranked_match_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_decay_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS decay_intervals_applied INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS decay_notified BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill existing rated rows with at least one played game from `last_updated`
-- so already-inactive players are evaluated accurately on the next Reaper sweep
-- without decaying brand-new zero-game rows.
UPDATE user_elo
SET last_ranked_match_at = last_updated
WHERE last_ranked_match_at IS NULL
  AND games_played > 0;

-- Partial index to keep periodic Reaper inactivity sweeps fast at scale.
CREATE INDEX IF NOT EXISTS idx_user_elo_inactivity_decay
    ON user_elo (last_ranked_match_at)
    WHERE current_rating > 100;

-- Partial index so 60s Reaper retries of pending first-decay notifications
-- never full-scan `user_elo`.
CREATE INDEX IF NOT EXISTS idx_user_elo_pending_decay_notify
    ON user_elo (last_decay_at)
    WHERE decay_notified = FALSE
      AND last_decay_at IS NOT NULL
      AND decay_intervals_applied > 0;
