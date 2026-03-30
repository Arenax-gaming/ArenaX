-- Rollback: Conflict Detection, Reaper Service, and Anti-Spam Schema

DROP TABLE IF EXISTS score_report_attempts;

DROP INDEX IF EXISTS idx_matches_reaper;

ALTER TABLE match_scores DROP COLUMN IF EXISTS opponent_score;

ALTER TABLE matches DROP COLUMN IF EXISTS conflict_reason;
ALTER TABLE matches DROP COLUMN IF EXISTS forfeited_by;
ALTER TABLE matches DROP COLUMN IF EXISTS report_deadline;
