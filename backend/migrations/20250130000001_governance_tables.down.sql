-- Governance Multisig Tables Migration (Down)
-- Removes all governance-related tables and views

-- Drop views first (they depend on tables)
DROP VIEW IF EXISTS v_governance_pending_proposals;
DROP VIEW IF EXISTS v_governance_proposals_with_approvals;

-- Drop tables (approvals references proposals, so drop it first)
DROP TABLE IF EXISTS governance_chain_sync;
DROP TABLE IF EXISTS governance_approvals;
DROP TABLE IF EXISTS governance_proposals;
