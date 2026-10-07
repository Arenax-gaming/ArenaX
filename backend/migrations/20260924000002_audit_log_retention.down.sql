-- Revert the seven-year retention scaffolding (Issue #946).
--
-- The archive table is dropped along with it: leaving an append-only table
-- behind with no function to populate it, and no column recording what it was
-- for, is worse than removing it cleanly.

DROP FUNCTION IF EXISTS archive_audit_logs_past_retention(TIMESTAMPTZ);

DROP RULE IF EXISTS audit_archive_no_update ON audit_logs_archive;
DROP RULE IF EXISTS audit_archive_no_delete ON audit_logs_archive;
DROP TABLE IF EXISTS audit_logs_archive;

DROP INDEX IF EXISTS idx_audit_logs_retained_until;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS retained_until;
