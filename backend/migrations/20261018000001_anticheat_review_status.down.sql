DROP INDEX IF EXISTS idx_anticheat_findings_review_queue;
ALTER TABLE anticheat_findings DROP COLUMN IF EXISTS reviewed_at;
