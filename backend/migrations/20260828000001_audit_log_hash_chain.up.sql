-- Audit logging for sensitive operations (Issue #863)
--
-- The audit_logs table from the core migration records who did what to which
-- resource, but three things it cannot do are exactly what an audit trail is
-- for:
--
--   1. It stores a free-form `details` blob rather than the before and after
--      values, so "the balance changed" is recorded but not what it changed
--      from. Reconstructing state at a point in time is impossible.
--   2. Nothing stops an UPDATE or DELETE. A trail that the application (or
--      anyone with the application's credentials) can rewrite is not evidence.
--   3. Even append-only is not enough on its own: a row can be removed and the
--      table still looks internally consistent. Detecting that requires each
--      row to commit to its predecessor.
--
-- This migration addresses all three, and wires triggers onto the payment and
-- reputation tables so the trail is written by the database rather than
-- depending on every call site remembering to log.

-- ---------------------------------------------------------------------------
-- 1. Structured before/after values and the hash chain columns
-- ---------------------------------------------------------------------------

ALTER TABLE audit_logs
    ADD COLUMN IF NOT EXISTS old_values JSONB,
    ADD COLUMN IF NOT EXISTS new_values JSONB,
    -- Monotonic position in the chain. A gap is itself evidence of deletion.
    ADD COLUMN IF NOT EXISTS sequence_number BIGSERIAL,
    -- SHA-256 over this row's content plus the previous row's hash.
    ADD COLUMN IF NOT EXISTS entry_hash TEXT,
    ADD COLUMN IF NOT EXISTS previous_hash TEXT,
    -- Which trigger or call site produced the row, for provenance.
    ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'application';

CREATE INDEX IF NOT EXISTS idx_audit_logs_sequence ON audit_logs(sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_source ON audit_logs(source);
-- GIN indexes make "which rows ever set this field" answerable without a scan.
CREATE INDEX IF NOT EXISTS idx_audit_logs_new_values ON audit_logs USING GIN (new_values);
CREATE INDEX IF NOT EXISTS idx_audit_logs_old_values ON audit_logs USING GIN (old_values);

-- ---------------------------------------------------------------------------
-- 2. Hash chain
-- ---------------------------------------------------------------------------

-- pgcrypto provides digest(); the core migration already relies on
-- uuid-ossp, so an extension dependency here is consistent with the schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

/*
 * Link each row to its predecessor.
 *
 * The hash covers the row's own content *and* the previous row's hash, so
 * altering any historical row invalidates every hash after it. An attacker who
 * can write to the table can still append, but cannot silently change or remove
 * history without the chain failing verification.
 *
 * The previous row is chosen by sequence_number rather than created_at:
 * timestamps can collide within a transaction, and a chain with an ambiguous
 * order cannot be verified deterministically.
 */
CREATE OR REPLACE FUNCTION audit_logs_build_hash_chain()
RETURNS TRIGGER AS $$
DECLARE
    prev_hash TEXT;
BEGIN
    SELECT entry_hash INTO prev_hash
    FROM audit_logs
    WHERE sequence_number < NEW.sequence_number
    ORDER BY sequence_number DESC
    LIMIT 1;

    -- The genesis row commits to a fixed marker rather than NULL, so that
    -- "no predecessor" is itself part of the signed content.
    NEW.previous_hash := COALESCE(prev_hash, 'genesis');

    NEW.entry_hash := encode(
        digest(
            COALESCE(NEW.previous_hash, '')
                || '|' || NEW.sequence_number::TEXT
                || '|' || COALESCE(NEW.user_id::TEXT, '')
                || '|' || NEW.action
                || '|' || NEW.resource_type
                || '|' || COALESCE(NEW.resource_id::TEXT, '')
                || '|' || COALESCE(NEW.old_values::TEXT, '')
                || '|' || COALESCE(NEW.new_values::TEXT, '')
                || '|' || COALESCE(NEW.created_at::TEXT, ''),
            'sha256'
        ),
        'hex'
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_logs_hash_chain
    BEFORE INSERT ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION audit_logs_build_hash_chain();

/*
 * Verify the chain over a range.
 *
 * Recomputes each row's hash from its content and its recorded previous_hash,
 * and checks the links join up. Returns the first break rather than a bare
 * boolean: an auditor needs to know *where* the trail was tampered with.
 */
CREATE OR REPLACE FUNCTION verify_audit_chain(
    from_sequence BIGINT DEFAULT 0,
    to_sequence BIGINT DEFAULT NULL
)
RETURNS TABLE (
    ok BOOLEAN,
    checked_rows BIGINT,
    first_bad_sequence BIGINT,
    reason TEXT
) AS $$
DECLARE
    rec RECORD;
    expected_hash TEXT;
    running_prev TEXT := NULL;
    n BIGINT := 0;
BEGIN
    FOR rec IN
        SELECT * FROM audit_logs
        WHERE sequence_number >= from_sequence
          AND (to_sequence IS NULL OR sequence_number <= to_sequence)
        ORDER BY sequence_number ASC
    LOOP
        n := n + 1;

        -- Each row must name the hash of the row before it.
        IF running_prev IS NOT NULL AND rec.previous_hash IS DISTINCT FROM running_prev THEN
            RETURN QUERY SELECT FALSE, n, rec.sequence_number,
                'previous_hash does not match the preceding row (a row was altered or removed)';
            RETURN;
        END IF;

        expected_hash := encode(
            digest(
                COALESCE(rec.previous_hash, '')
                    || '|' || rec.sequence_number::TEXT
                    || '|' || COALESCE(rec.user_id::TEXT, '')
                    || '|' || rec.action
                    || '|' || rec.resource_type
                    || '|' || COALESCE(rec.resource_id::TEXT, '')
                    || '|' || COALESCE(rec.old_values::TEXT, '')
                    || '|' || COALESCE(rec.new_values::TEXT, '')
                    || '|' || COALESCE(rec.created_at::TEXT, ''),
                'sha256'
            ),
            'hex'
        );

        IF rec.entry_hash IS DISTINCT FROM expected_hash THEN
            RETURN QUERY SELECT FALSE, n, rec.sequence_number,
                'entry_hash does not match the row content (this row was altered)';
            RETURN;
        END IF;

        running_prev := rec.entry_hash;
    END LOOP;

    RETURN QUERY SELECT TRUE, n, NULL::BIGINT, 'chain intact'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 3. Append-only enforcement
-- ---------------------------------------------------------------------------

/*
 * Reject UPDATE and DELETE outright.
 *
 * A RULE rather than a trigger: rules are applied during query rewrite, so
 * even a bulk `DELETE FROM audit_logs` is refused rather than executing
 * row-by-row and stopping partway.
 *
 * This is not protection against a superuser, who can drop the rules. It is
 * protection against the application, a compromised service account, and the
 * ordinary accident - which is the realistic threat model for an audit trail.
 * The hash chain covers what the rules cannot.
 */
CREATE RULE audit_logs_no_update AS
    ON UPDATE TO audit_logs
    DO INSTEAD NOTHING;

CREATE RULE audit_logs_no_delete AS
    ON DELETE TO audit_logs
    DO INSTEAD NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Triggers on sensitive tables
-- ---------------------------------------------------------------------------

/*
 * Generic row-change auditor.
 *
 * Writing the trail from the database rather than the application means it
 * cannot be skipped by a new code path that forgets to log - which is how audit
 * gaps normally appear.
 *
 * `to_jsonb(OLD)` / `to_jsonb(NEW)` capture the whole row, so the before and
 * after states are recoverable field by field without this function needing to
 * know the table's columns.
 */
CREATE OR REPLACE FUNCTION audit_row_change()
RETURNS TRIGGER AS $$
DECLARE
    actor UUID;
    old_json JSONB;
    new_json JSONB;
    resource UUID;
BEGIN
    old_json := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    new_json := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;

    -- Prefer an explicitly set actor, falling back to the row's own user_id.
    -- The application sets audit.actor_id per request; when it has not (a
    -- migration, a manual fix), the row still gets logged with a NULL actor
    -- rather than being dropped.
    BEGIN
        actor := NULLIF(current_setting('audit.actor_id', TRUE), '')::UUID;
    EXCEPTION WHEN OTHERS THEN
        actor := NULL;
    END;

    IF actor IS NULL THEN
        actor := COALESCE(
            (new_json ->> 'user_id')::UUID,
            (old_json ->> 'user_id')::UUID
        );
    END IF;

    resource := COALESCE((new_json ->> 'id')::UUID, (old_json ->> 'id')::UUID);

    INSERT INTO audit_logs (
        user_id, action, resource_type, resource_id,
        old_values, new_values, source, created_at
    ) VALUES (
        actor,
        LOWER(TG_OP),
        TG_TABLE_NAME,
        resource,
        old_json,
        new_json,
        'trigger',
        NOW()
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

/*
 * Attach the auditor to the sensitive tables named in the issue.
 *
 * Done dynamically because this schema has evolved across many migrations and
 * the exact table names for payments and reputation differ between
 * deployments. Attaching only to tables that exist keeps the migration from
 * failing on an environment that does not have all of them yet - a hard
 * failure here would block every later migration.
 */
DO $$
DECLARE
    target TEXT;
    sensitive_tables TEXT[] := ARRAY[
        'payments',
        'transactions',
        'prize_distributions',
        'wallet_transactions',
        'reputation_scores',
        'reputation_events',
        'user_reputation'
    ];
BEGIN
    FOREACH target IN ARRAY sensitive_tables LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = target
        ) THEN
            EXECUTE format(
                'DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$I', target
            );
            EXECUTE format(
                'CREATE TRIGGER trg_audit_%1$s
                     AFTER INSERT OR UPDATE OR DELETE ON %1$I
                     FOR EACH ROW EXECUTE FUNCTION audit_row_change()',
                target
            );
            RAISE NOTICE 'Audit trigger attached to %', target;
        ELSE
            RAISE NOTICE 'Skipping audit trigger for % (table not present)', target;
        END IF;
    END LOOP;
END;
$$;
