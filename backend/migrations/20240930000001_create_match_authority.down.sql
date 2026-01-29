-- Rollback Match Authority & State Synchronization

-- Drop views
DROP VIEW IF EXISTS divergent_matches;
DROP VIEW IF EXISTS pending_chain_ops;
DROP VIEW IF EXISTS active_matches;

-- Drop triggers
DROP TRIGGER IF EXISTS set_match_authority_timestamps ON match_authority;
DROP TRIGGER IF EXISTS auto_log_match_transitions ON match_authority;
DROP TRIGGER IF EXISTS enforce_match_state_transitions ON match_authority;

-- Drop functions
DROP FUNCTION IF EXISTS update_match_authority_timestamp();
DROP FUNCTION IF EXISTS log_match_state_transition();
DROP FUNCTION IF EXISTS validate_match_state_transition();

-- Drop tables (in reverse dependency order)
DROP TABLE IF EXISTS match_operations;
DROP TABLE IF EXISTS match_reconciliation_log;
DROP TABLE IF EXISTS match_chain_sync;
DROP TABLE IF EXISTS match_transitions;
DROP TABLE IF EXISTS match_authority;

-- Drop enum type
DROP TYPE IF EXISTS match_authority_state;
