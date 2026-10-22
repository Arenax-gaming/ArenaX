-- Anti-cheat flag review state (Issue #1233).
--
-- A flagged finding stays in the admin review queue, and holds payouts for its
-- match's tournament, until an admin marks it reviewed.

ALTER TABLE anticheat_findings ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_anticheat_findings_review_queue
    ON anticheat_findings (created_at)
    WHERE flagged AND reviewed_at IS NULL;
