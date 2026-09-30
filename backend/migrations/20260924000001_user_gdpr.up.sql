-- GDPR / NDPR user account erasure & data portability (Issue #1078)
--
-- Adds soft-delete support to `users` and a queue table for asynchronous
-- data-export jobs (delivered via email link).

-- Soft-delete column: set to NOW() when the user exercises their right to
-- erasure. PII is anonymised in code at deletion time; the row is kept so
-- match history, tournament results and on-chain audit trails keep a stable
-- reference (never a hard delete).
ALTER TABLE users
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- Data export jobs (async, delivered via email link once ready).
CREATE TABLE IF NOT EXISTS data_export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'queued', -- queued | processing | ready | failed
    export_link TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_data_export_jobs_user ON data_export_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_data_export_jobs_status ON data_export_jobs(status);

COMMENT ON COLUMN users.deleted_at IS 'Soft-delete marker (GDPR/NDPR erasure). PII anonymised at deletion time.';
COMMENT ON TABLE data_export_jobs IS 'Asynchronous GDPR data-export requests delivered by email link.';