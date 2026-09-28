-- Seven-year retention for the audit trail (Issue #946)
--
-- The trail is append-only and hash-chained (Issue #863), which is what makes
-- it evidence — and also what makes retention awkward: the chain is only
-- verifiable while the rows it covers are contiguous, so deleting the oldest
-- entries would break verification of every entry after them.
--
-- Retention is therefore expressed as archival, not deletion. Entries older
-- than the period are copied into `audit_logs_archive` with their hashes
-- intact; the hot table keeps them until an operator explicitly prunes, and the
-- archive remains verifiable on its own.

-- ---------------------------------------------------------------------------
-- 1. Declare the retention period on each row
-- ---------------------------------------------------------------------------

/*
 * Stored per row rather than computed at query time so that a future change to
 * the policy does not retroactively expire entries written under the old one —
 * which is the kind of silent reinterpretation a retention policy exists to
 * prevent.
 */
ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS retained_until TIMESTAMPTZ
        NOT NULL DEFAULT (NOW() + INTERVAL '7 years');

CREATE INDEX IF NOT EXISTS idx_audit_logs_retained_until
    ON audit_logs(retained_until);

-- ---------------------------------------------------------------------------
-- 2. Archive table
-- ---------------------------------------------------------------------------

/*
 * Mirrors the live table, hashes included, so the chain over archived rows can
 * still be recomputed. `archived_at` records when the sweep moved the row,
 * which is separate from when the event happened.
 */
CREATE TABLE IF NOT EXISTS audit_logs_archive (
    id UUID PRIMARY KEY,
    sequence_number BIGINT NOT NULL,
    user_id UUID,
    action VARCHAR(50) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    details TEXT,
    old_values JSONB,
    new_values JSONB,
    ip_address INET,
    user_agent TEXT,
    source VARCHAR(50) NOT NULL,
    entry_hash TEXT,
    previous_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    retained_until TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_archive_sequence
    ON audit_logs_archive(sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_archive_user
    ON audit_logs_archive(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_archive_resource
    ON audit_logs_archive(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_archive_created
    ON audit_logs_archive(created_at DESC);

-- The archive is evidence too: it gets the same append-only treatment.
DROP RULE IF EXISTS audit_archive_no_update ON audit_logs_archive;
DROP RULE IF EXISTS audit_archive_no_delete ON audit_logs_archive;

CREATE RULE audit_archive_no_update AS
    ON UPDATE TO audit_logs_archive
    DO INSTEAD NOTHING;

CREATE RULE audit_archive_no_delete AS
    ON DELETE TO audit_logs_archive
    DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Sweep
-- ---------------------------------------------------------------------------

/*
 * Copy entries whose retention period has elapsed into the archive.
 *
 * Idempotent: `ON CONFLICT DO NOTHING` on the primary key means a re-run after
 * a partial failure, or a scheduler firing twice, archives nothing extra.
 *
 * The cutoff is a parameter rather than `NOW() - INTERVAL '7 years'` so the
 * caller — and its tests — can sweep against an explicit date, and so the
 * period lives in one place (the service constant) rather than two.
 */
CREATE OR REPLACE FUNCTION archive_audit_logs_past_retention(cutoff TIMESTAMPTZ)
RETURNS BIGINT AS $$
DECLARE
    moved BIGINT;
BEGIN
    INSERT INTO audit_logs_archive (
        id, sequence_number, user_id, action, resource_type, resource_id,
        details, old_values, new_values, ip_address, user_agent, source,
        entry_hash, previous_hash, created_at, retained_until
    )
    SELECT
        id, sequence_number, user_id, action, resource_type, resource_id,
        details, old_values, new_values, ip_address, user_agent, source,
        entry_hash, previous_hash, created_at, retained_until
    FROM audit_logs
    WHERE created_at < cutoff
    ON CONFLICT (id) DO NOTHING;

    GET DIAGNOSTICS moved = ROW_COUNT;
    RETURN moved;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION archive_audit_logs_past_retention(TIMESTAMPTZ) IS
    'Copies audit entries older than the cutoff into audit_logs_archive. Idempotent; never deletes.';

COMMENT ON COLUMN audit_logs.retained_until IS
    'Earliest date this entry may be archived. Seven years from creation (Issue #946).';
