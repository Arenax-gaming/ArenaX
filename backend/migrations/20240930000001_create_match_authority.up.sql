-- Match Authority & State Synchronization Migration
-- This creates tables for the finite state machine-based match authority service

-- ============================================================================
-- MATCH AUTHORITY ENTITIES
-- ============================================================================

-- Match Authority states: CREATED, STARTED, COMPLETED, DISPUTED, FINALIZED
CREATE TYPE match_authority_state AS ENUM ('CREATED', 'STARTED', 'COMPLETED', 'DISPUTED', 'FINALIZED');

-- Core match authority table enforcing FSM
CREATE TABLE match_authority (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    on_chain_match_id VARCHAR(64) NOT NULL UNIQUE, -- bytes32 from Soroban
    player_a VARCHAR(56) NOT NULL, -- Stellar address
    player_b VARCHAR(56) NOT NULL, -- Stellar address
    winner VARCHAR(56), -- Stellar address of winner
    state match_authority_state NOT NULL DEFAULT 'CREATED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    last_chain_tx VARCHAR(64), -- Last blockchain transaction hash
    idempotency_key VARCHAR(255) UNIQUE, -- For idempotent operations
    metadata JSONB DEFAULT '{}'::jsonb -- Additional data
);

CREATE INDEX idx_match_authority_state ON match_authority(state);
CREATE INDEX idx_match_authority_players ON match_authority(player_a, player_b);
CREATE INDEX idx_match_authority_on_chain_id ON match_authority(on_chain_match_id);
CREATE INDEX idx_match_authority_created_at ON match_authority(created_at DESC);
CREATE INDEX idx_match_authority_idempotency ON match_authority(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- State transition audit log
CREATE TABLE match_transitions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES match_authority(id) ON DELETE CASCADE,
    from_state match_authority_state NOT NULL,
    to_state match_authority_state NOT NULL,
    actor VARCHAR(56) NOT NULL, -- Who/what initiated the transition
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    chain_tx VARCHAR(64), -- Associated blockchain transaction
    metadata JSONB DEFAULT '{}'::jsonb,
    error TEXT -- Error message if transition failed
);

CREATE INDEX idx_match_transitions_match ON match_transitions(match_id);
CREATE INDEX idx_match_transitions_timestamp ON match_transitions(timestamp DESC);
CREATE INDEX idx_match_transitions_states ON match_transitions(from_state, to_state);

-- Blockchain synchronization tracking
CREATE TABLE match_chain_sync (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES match_authority(id) ON DELETE CASCADE,
    operation_type VARCHAR(50) NOT NULL, -- create_match, start_match, complete_match, raise_dispute, finalize
    tx_hash VARCHAR(64) NOT NULL UNIQUE,
    tx_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, success, failed
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    block_height BIGINT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_match_chain_sync_match ON match_chain_sync(match_id);
CREATE INDEX idx_match_chain_sync_tx_hash ON match_chain_sync(tx_hash);
CREATE INDEX idx_match_chain_sync_status ON match_chain_sync(tx_status);
CREATE INDEX idx_match_chain_sync_submitted ON match_chain_sync(submitted_at DESC);

-- Reconciliation log for detecting divergence
CREATE TABLE match_reconciliation_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES match_authority(id) ON DELETE CASCADE,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    off_chain_state match_authority_state NOT NULL,
    on_chain_state VARCHAR(50) NOT NULL,
    is_divergent BOOLEAN NOT NULL,
    resolution_action TEXT,
    resolved_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_match_reconciliation_match ON match_reconciliation_log(match_id);
CREATE INDEX idx_match_reconciliation_checked ON match_reconciliation_log(checked_at DESC);
CREATE INDEX idx_match_reconciliation_divergent ON match_reconciliation_log(is_divergent) WHERE is_divergent = TRUE;

-- Idempotency tracking table
CREATE TABLE match_operations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    match_id UUID NOT NULL REFERENCES match_authority(id) ON DELETE CASCADE,
    operation VARCHAR(50) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'processing', -- processing, completed, failed
    request_payload JSONB,
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_match_operations_match ON match_operations(match_id);
CREATE INDEX idx_match_operations_key ON match_operations(idempotency_key);
CREATE INDEX idx_match_operations_status ON match_operations(status);

-- ============================================================================
-- CONSTRAINTS AND TRIGGERS
-- ============================================================================

-- Function to validate state transitions
CREATE OR REPLACE FUNCTION validate_match_state_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- Valid transitions:
    -- CREATED -> STARTED
    -- STARTED -> COMPLETED
    -- COMPLETED -> DISPUTED or FINALIZED
    -- DISPUTED -> FINALIZED

    IF OLD.state = 'CREATED' AND NEW.state NOT IN ('CREATED', 'STARTED') THEN
        RAISE EXCEPTION 'Invalid transition from CREATED to %', NEW.state;
    END IF;

    IF OLD.state = 'STARTED' AND NEW.state NOT IN ('STARTED', 'COMPLETED') THEN
        RAISE EXCEPTION 'Invalid transition from STARTED to %', NEW.state;
    END IF;

    IF OLD.state = 'COMPLETED' AND NEW.state NOT IN ('COMPLETED', 'DISPUTED', 'FINALIZED') THEN
        RAISE EXCEPTION 'Invalid transition from COMPLETED to %', NEW.state;
    END IF;

    IF OLD.state = 'DISPUTED' AND NEW.state NOT IN ('DISPUTED', 'FINALIZED') THEN
        RAISE EXCEPTION 'Invalid transition from DISPUTED to %', NEW.state;
    END IF;

    IF OLD.state = 'FINALIZED' THEN
        RAISE EXCEPTION 'Cannot transition from FINALIZED state';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the validation trigger
CREATE TRIGGER enforce_match_state_transitions
    BEFORE UPDATE ON match_authority
    FOR EACH ROW
    WHEN (OLD.state IS DISTINCT FROM NEW.state)
    EXECUTE FUNCTION validate_match_state_transition();

-- Function to auto-create transition records
CREATE OR REPLACE FUNCTION log_match_state_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.state IS DISTINCT FROM NEW.state THEN
        INSERT INTO match_transitions (
            match_id,
            from_state,
            to_state,
            actor,
            chain_tx,
            metadata
        ) VALUES (
            NEW.id,
            OLD.state,
            NEW.state,
            'system', -- Will be overridden by application
            NEW.last_chain_tx,
            jsonb_build_object(
                'updated_at', NOW(),
                'trigger', 'auto'
            )
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the auto-logging trigger
CREATE TRIGGER auto_log_match_transitions
    AFTER UPDATE ON match_authority
    FOR EACH ROW
    WHEN (OLD.state IS DISTINCT FROM NEW.state)
    EXECUTE FUNCTION log_match_state_transition();

-- Update timestamps
CREATE OR REPLACE FUNCTION update_match_authority_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    -- Set started_at when moving to STARTED
    IF NEW.state = 'STARTED' AND OLD.state != 'STARTED' THEN
        NEW.started_at = NOW();
    END IF;

    -- Set ended_at when moving to COMPLETED, DISPUTED, or FINALIZED
    IF NEW.state IN ('COMPLETED', 'DISPUTED', 'FINALIZED') AND
       OLD.state NOT IN ('COMPLETED', 'DISPUTED', 'FINALIZED') THEN
        NEW.ended_at = NOW();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_match_authority_timestamps
    BEFORE UPDATE ON match_authority
    FOR EACH ROW
    EXECUTE FUNCTION update_match_authority_timestamp();

-- ============================================================================
-- VIEWS FOR MONITORING
-- ============================================================================

-- View for active matches
CREATE VIEW active_matches AS
SELECT
    ma.*,
    (SELECT COUNT(*) FROM match_transitions WHERE match_id = ma.id) as transition_count,
    (SELECT MAX(timestamp) FROM match_transitions WHERE match_id = ma.id) as last_transition_at
FROM match_authority ma
WHERE ma.state NOT IN ('FINALIZED');

-- View for matches with pending blockchain operations
CREATE VIEW pending_chain_ops AS
SELECT
    ma.id as match_id,
    ma.on_chain_match_id,
    ma.state,
    mcs.operation_type,
    mcs.tx_hash,
    mcs.submitted_at,
    mcs.retry_count
FROM match_authority ma
JOIN match_chain_sync mcs ON mcs.match_id = ma.id
WHERE mcs.tx_status = 'pending'
ORDER BY mcs.submitted_at ASC;

-- View for divergent matches (need reconciliation)
CREATE VIEW divergent_matches AS
SELECT
    ma.id as match_id,
    ma.on_chain_match_id,
    ma.state as off_chain_state,
    mrl.on_chain_state,
    mrl.checked_at,
    mrl.resolution_action
FROM match_authority ma
JOIN match_reconciliation_log mrl ON mrl.match_id = ma.id
WHERE mrl.is_divergent = TRUE
  AND mrl.resolved_at IS NULL
ORDER BY mrl.checked_at DESC;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE match_authority IS 'Core finite state machine for match lifecycle management with blockchain sync';
COMMENT ON TABLE match_transitions IS 'Audit log of all state transitions for matches';
COMMENT ON TABLE match_chain_sync IS 'Tracks blockchain transaction status for match operations';
COMMENT ON TABLE match_reconciliation_log IS 'Detects and logs divergence between on-chain and off-chain state';
COMMENT ON TABLE match_operations IS 'Ensures idempotent operations with deduplication keys';
COMMENT ON COLUMN match_authority.idempotency_key IS 'Unique key to prevent duplicate match creation';
COMMENT ON COLUMN match_authority.on_chain_match_id IS 'Unique identifier from Soroban contract (bytes32)';
