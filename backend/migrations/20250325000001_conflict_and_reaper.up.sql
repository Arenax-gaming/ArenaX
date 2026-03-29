-- Conflict Detection, Reaper Service, and Anti-Spam Schema
-- Migration: 20250325000001_conflict_and_reaper
-- Description:
--   1. Adds report_deadline to matches so the Reaper knows when to forfeit.
--   2. Adds forfeited_by to record which player was auto-forfeited.
--   3. Adds conflict_reason to store the human-readable discrepancy description.
--   4. Adds opponent_score to match_scores so conflict detection can compare reports.
--   5. Creates score_report_attempts for per-match anti-spam rate limiting.

-- ============================================================================
-- MATCHES TABLE: deadline + forfeit tracking + conflict state
-- ============================================================================

-- Set when match transitions to in_progress; Reaper uses this as the expiry
ALTER TABLE matches ADD COLUMN IF NOT EXISTS report_deadline TIMESTAMPTZ;

-- Which player (if any) was auto-forfeited by the Reaper
ALTER TABLE matches ADD COLUMN IF NOT EXISTS forfeited_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Human-readable reason the match entered the conflict state
ALTER TABLE matches ADD COLUMN IF NOT EXISTS conflict_reason TEXT;

-- Composite index for efficient Reaper queries:
-- "find all in_progress matches whose deadline has passed"
CREATE INDEX IF NOT EXISTS idx_matches_reaper
    ON matches(status, report_deadline)
    WHERE report_deadline IS NOT NULL;

-- ============================================================================
-- MATCH_SCORES TABLE: opponent's claimed score for conflict detection
-- ============================================================================

-- Each reporter submits their own score AND what they believe the opponent scored.
-- When both reports are in, the system compares claimed winners to detect conflicts.
ALTER TABLE match_scores ADD COLUMN IF NOT EXISTS opponent_score INTEGER;

-- ============================================================================
-- SCORE REPORT RATE-LIMITING (Anti-Spam)
-- ============================================================================

-- Every call to report_score is logged here.
-- Callers that exceed MAX_ATTEMPTS_PER_MATCH receive HTTP 429.
CREATE TABLE IF NOT EXISTS score_report_attempts (
    id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id     UUID        NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id    UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- TRUE only when the attempt passed all validation and a score row was inserted
    accepted     BOOLEAN     NOT NULL DEFAULT FALSE,
    rejection_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_sra_player_match
    ON score_report_attempts(player_id, match_id);

CREATE INDEX IF NOT EXISTS idx_sra_attempted_at
    ON score_report_attempts(attempted_at DESC);

COMMENT ON TABLE score_report_attempts IS
    'Tracks every score-report attempt per player per match for anti-spam enforcement.';
COMMENT ON COLUMN score_report_attempts.accepted IS
    'TRUE when the attempt cleared all validation and a match_scores row was written.';
COMMENT ON COLUMN matches.report_deadline IS
    'Set to NOW() + 24 h when status moves to in_progress. The Reaper forfeits non-reporters after this time.';
COMMENT ON COLUMN matches.forfeited_by IS
    'User ID of the player auto-forfeited by the Reaper for failing to report in time.';
COMMENT ON COLUMN matches.conflict_reason IS
    'Human-readable description of the score discrepancy that triggered the conflict state.';
COMMENT ON COLUMN match_scores.opponent_score IS
    'What the submitting player claims their opponent scored; used for conflict detection.';
