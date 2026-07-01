/**
 * Governance types — derived from the governance_proposals and
 * governance_approvals DB schema (migration 20250130000001).
 */

export type ProposalStatus =
  | "PENDING"
  | "APPROVED"
  | "EXECUTED"
  | "CANCELLED"
  | "FAILED";

export type VoteChoice = "yes" | "no" | "abstain";

export interface Proposal {
  /** Internal UUID */
  id: string;
  /** On-chain hex proposal ID (e.g. "0x1234…") */
  proposal_id: string;
  /** Stellar contract address */
  target_contract: string;
  /** Function name to invoke on the target contract */
  function: string;
  /** Decoded function arguments */
  args: Record<string, unknown>;
  /** Human-readable description */
  description?: string;
  status: ProposalStatus;
  /** Stellar address of the proposer */
  proposer: string;
  created_at: string;
  /** ISO datetime — earliest time the proposal can be executed */
  execute_after?: string;
  executed_at?: string;
  /** Last on-chain transaction hash */
  last_chain_tx?: string;
  /** Approval / vote count (from view v_governance_proposals_with_approvals) */
  approval_count?: number;
  /** Ordered list of approver Stellar addresses */
  approvers?: string[];

  // Extended vote breakdown — may be present on detail endpoint
  vote_breakdown?: {
    yes: number;
    no: number;
    abstain: number;
  };
}

export interface CreateProposalDto {
  target_contract: string;
  function: string;
  args: Record<string, unknown>;
  description?: string;
  /** Unix timestamp for the earliest execution time */
  execute_after?: number;
}

export type ProposalTab = "active" | "passed" | "failed";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  PENDING: "Active",
  APPROVED: "Passed",
  EXECUTED: "Executed",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
};

/** Maps a DB status to the tab it belongs to */
export function statusToTab(status: ProposalStatus): ProposalTab {
  if (status === "PENDING" || status === "APPROVED") return "active";
  if (status === "EXECUTED") return "passed";
  return "failed";
}

/** Whether voting should be enabled for a proposal */
export function isVotable(proposal: Proposal): boolean {
  if (proposal.status !== "PENDING") return false;
  if (proposal.execute_after) {
    return new Date(proposal.execute_after) > new Date();
  }
  return true;
}
