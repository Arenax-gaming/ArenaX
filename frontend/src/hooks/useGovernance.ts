/**
 * React-Query hooks for governance proposals.
 * Mirrors the pattern used by useLeaderboard.ts.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Proposal, VoteChoice } from "@/types/governance";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------
export const GOVERNANCE_KEYS = {
  all: ["governance"] as const,
  proposals: () => [...GOVERNANCE_KEYS.all, "proposals"] as const,
  proposal: (id: string) => [...GOVERNANCE_KEYS.all, "proposal", id] as const,
} as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Fetch all proposals from GET /governance */
export function useProposals() {
  return useQuery<Proposal[]>({
    queryKey: GOVERNANCE_KEYS.proposals(),
    queryFn: () => api.getProposals() as Promise<Proposal[]>,
    staleTime: 30_000,
  });
}

/** Fetch a single proposal from GET /governance/:id */
export function useProposal(id: string) {
  return useQuery<Proposal>({
    queryKey: GOVERNANCE_KEYS.proposal(id),
    queryFn: () => api.getProposal(id) as Promise<Proposal>,
    enabled: !!id,
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Cast a vote on a proposal.
 *
 * The existing API endpoint POST /governance/:id/vote accepts an optional
 * `signature`. We map the UX choice (yes / no / abstain) to that payload.
 * When the backend extends the endpoint to accept a `vote` field this hook
 * only needs updating here.
 */
export function useVoteOnProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      choice,
      signature,
    }: {
      id: string;
      choice: VoteChoice;
      signature?: string;
    }) =>
      api.voteOnProposal(id, signature) as Promise<unknown>,
    onSuccess: (_data, { id }) => {
      // Invalidate both the list and the individual proposal so counts refresh.
      qc.invalidateQueries({ queryKey: GOVERNANCE_KEYS.proposals() });
      qc.invalidateQueries({ queryKey: GOVERNANCE_KEYS.proposal(id) });
    },
  });
}

/** Trigger execution of an APPROVED proposal */
export function useExecuteProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.executeProposal(id) as Promise<unknown>,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: GOVERNANCE_KEYS.proposals() });
      qc.invalidateQueries({ queryKey: GOVERNANCE_KEYS.proposal(id) });
    },
  });
}

/** Start the voting period on a PENDING proposal */
export function useStartVoting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.startVoting(id) as Promise<unknown>,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: GOVERNANCE_KEYS.proposals() });
      qc.invalidateQueries({ queryKey: GOVERNANCE_KEYS.proposal(id) });
    },
  });
}
