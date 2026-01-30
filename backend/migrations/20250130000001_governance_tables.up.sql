-- Governance Multisig Tables Migration
-- Creates tables for tracking governance proposals, approvals, and chain synchronization

-- ============================================================================
-- Governance Proposals Table
-- ============================================================================
-- Tracks all governance proposals submitted through the multisig contract

CREATE TABLE IF NOT EXISTS governance_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- On-chain proposal ID (hex-encoded 32 bytes, e.g., "0x1234...")
    proposal_id VARCHAR(66) UNIQUE NOT NULL,
    -- Target contract address (Stellar contract ID)
    target_contract VARCHAR(56) NOT NULL,
    -- Function name to invoke on the target
    function VARCHAR(64) NOT NULL,
    -- Function arguments as JSON (XDR-decoded for readability)
    args JSONB NOT NULL DEFAULT '{}',
    -- Human-readable description of the proposal
    description TEXT,
    -- Current proposal status
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'EXECUTED', 'CANCELLED', 'FAILED')),
    -- Address of the signer who created the proposal
    proposer VARCHAR(56) NOT NULL,
    -- When the proposal was created in our database
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Earliest time the proposal can be executed (if time-locked)
    execute_after TIMESTAMPTZ,
    -- When the proposal was executed (if executed)
    executed_at TIMESTAMPTZ,
    -- Hash of the last blockchain transaction related to this proposal
    last_chain_tx VARCHAR(66)
);

-- Index for querying by status
CREATE INDEX IF NOT EXISTS idx_governance_proposals_status
    ON governance_proposals(status);

-- Index for querying by proposer
CREATE INDEX IF NOT EXISTS idx_governance_proposals_proposer
    ON governance_proposals(proposer);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_governance_proposals_created_at
    ON governance_proposals(created_at DESC);

-- ============================================================================
-- Governance Approvals Table
-- ============================================================================
-- Tracks individual signer approvals for proposals

CREATE TABLE IF NOT EXISTS governance_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Reference to the proposal being approved
    proposal_id VARCHAR(66) NOT NULL REFERENCES governance_proposals(proposal_id) ON DELETE CASCADE,
    -- Address of the signer who approved
    signer VARCHAR(56) NOT NULL,
    -- Hash of the approval transaction on chain
    chain_tx VARCHAR(66),
    -- When the approval was recorded
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Each signer can only approve once per proposal
    UNIQUE(proposal_id, signer)
);

-- Index for querying approvals by proposal
CREATE INDEX IF NOT EXISTS idx_governance_approvals_proposal
    ON governance_approvals(proposal_id);

-- Index for querying approvals by signer
CREATE INDEX IF NOT EXISTS idx_governance_approvals_signer
    ON governance_approvals(signer);

-- ============================================================================
-- Governance Chain Sync Table
-- ============================================================================
-- Audit log of all blockchain transactions related to governance

CREATE TABLE IF NOT EXISTS governance_chain_sync (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Proposal ID this sync relates to
    proposal_id VARCHAR(66) NOT NULL,
    -- Type of operation (CREATE, APPROVE, REVOKE, EXECUTE, CANCEL)
    operation VARCHAR(32) NOT NULL
        CHECK (operation IN ('CREATE', 'APPROVE', 'REVOKE', 'EXECUTE', 'CANCEL')),
    -- Transaction hash on the blockchain
    tx_hash VARCHAR(66) NOT NULL,
    -- Status of the transaction
    tx_status VARCHAR(20) NOT NULL
        CHECK (tx_status IN ('PENDING', 'SUCCESS', 'FAILED')),
    -- When this sync record was created
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by proposal
CREATE INDEX IF NOT EXISTS idx_governance_chain_sync_proposal
    ON governance_chain_sync(proposal_id);

-- Index for querying by transaction hash
CREATE INDEX IF NOT EXISTS idx_governance_chain_sync_tx_hash
    ON governance_chain_sync(tx_hash);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_governance_chain_sync_synced_at
    ON governance_chain_sync(synced_at DESC);

-- ============================================================================
-- Views
-- ============================================================================

-- View for proposals with approval counts
CREATE OR REPLACE VIEW v_governance_proposals_with_approvals AS
SELECT
    p.*,
    COALESCE(a.approval_count, 0) as approval_count,
    a.approvers
FROM governance_proposals p
LEFT JOIN (
    SELECT
        proposal_id,
        COUNT(*) as approval_count,
        ARRAY_AGG(signer ORDER BY approved_at) as approvers
    FROM governance_approvals
    GROUP BY proposal_id
) a ON p.proposal_id = a.proposal_id;

-- View for pending proposals that can be executed (have enough approvals)
-- Note: This would need to know the current threshold from the contract
-- For now, we create a simple view showing pending proposals with approvals
CREATE OR REPLACE VIEW v_governance_pending_proposals AS
SELECT
    p.proposal_id,
    p.target_contract,
    p.function,
    p.description,
    p.proposer,
    p.created_at,
    p.execute_after,
    COALESCE(a.approval_count, 0) as approval_count,
    a.approvers
FROM governance_proposals p
LEFT JOIN (
    SELECT
        proposal_id,
        COUNT(*) as approval_count,
        ARRAY_AGG(signer ORDER BY approved_at) as approvers
    FROM governance_approvals
    GROUP BY proposal_id
) a ON p.proposal_id = a.proposal_id
WHERE p.status = 'PENDING' OR p.status = 'APPROVED'
ORDER BY p.created_at DESC;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE governance_proposals IS
    'Tracks governance proposals for the ArenaX multisig governance contract';

COMMENT ON TABLE governance_approvals IS
    'Tracks individual signer approvals for governance proposals';

COMMENT ON TABLE governance_chain_sync IS
    'Audit log of blockchain transactions related to governance operations';

COMMENT ON COLUMN governance_proposals.proposal_id IS
    'On-chain proposal identifier (hex-encoded 32 bytes)';

COMMENT ON COLUMN governance_proposals.status IS
    'Current status: PENDING (awaiting approvals), APPROVED (ready to execute), EXECUTED, CANCELLED, or FAILED';

COMMENT ON COLUMN governance_chain_sync.operation IS
    'Type of governance operation: CREATE, APPROVE, REVOKE, EXECUTE, or CANCEL';
