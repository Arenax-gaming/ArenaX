-- Revert audit logging for sensitive operations (Issue #863)

-- Triggers on the sensitive tables, dropped only where the table exists.
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
            EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON %1$I', target);
        END IF;
    END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS audit_row_change();

-- The append-only rules must go before the hash-chain trigger, or a later
-- rollback step cannot touch the table.
DROP RULE IF EXISTS audit_logs_no_update ON audit_logs;
DROP RULE IF EXISTS audit_logs_no_delete ON audit_logs;

DROP TRIGGER IF EXISTS trg_audit_logs_hash_chain ON audit_logs;
DROP FUNCTION IF EXISTS audit_logs_build_hash_chain();
DROP FUNCTION IF EXISTS verify_audit_chain(BIGINT, BIGINT);

DROP INDEX IF EXISTS idx_audit_logs_old_values;
DROP INDEX IF EXISTS idx_audit_logs_new_values;
DROP INDEX IF EXISTS idx_audit_logs_source;
DROP INDEX IF EXISTS idx_audit_logs_sequence;

-- Columns are dropped last. Existing audit rows are preserved: the trail
-- predates this migration and dropping it on rollback would destroy the
-- evidence the feature exists to keep.
ALTER TABLE audit_logs
    DROP COLUMN IF EXISTS source,
    DROP COLUMN IF EXISTS previous_hash,
    DROP COLUMN IF EXISTS entry_hash,
    DROP COLUMN IF EXISTS sequence_number,
    DROP COLUMN IF EXISTS new_values,
    DROP COLUMN IF EXISTS old_values;
