-- Revert GDPR / NDPR user account erasure & data portability (Issue #1078)

DROP INDEX IF EXISTS idx_data_export_jobs_status;
DROP INDEX IF EXISTS idx_data_export_jobs_user;
DROP TABLE IF EXISTS data_export_jobs;

DROP INDEX IF EXISTS idx_users_deleted_at;
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;