/**
 * React-Query hooks for governance proposals.
 * Mirrors the pattern used by useLeaderboard.ts.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Proposal, VoteChoice } from "@/types/governance";

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

/**
 * Returns true when a JWT access token is present in storage.
 * Works in both localStorage (remember-me) and sessionStorage (session-only).
 */
function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    localStorage.getItem("auth_token") ?? sessionStorage.getItem("auth_token")
  );
}

/**
 * Converts a raw API error into a user-friendly auth error when it looks like
 * an unauthenticated / forbidden response.
 */
function rethrowAuthError(error: unknown, defaultMessage: string): never {
  const message =
    error instanceof Error ? error.message : String(error ?? defaultMessage);

  // Backend returns "Unauthorized" or "Forbidden" on 401 / 403
  if (
    /unauthori[zs]ed|forbidden|invalid token|jwt|authentication/i.test(message)
  ) {
    throw new Error("Please log in to perform this action.");
  }

  throw error instanceof Error ? error : new Error(message);
}

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
 * Guards the mutation: throws a user-visible "Please log in to vote" error
 * when no auth token is present, rather than letting a silent 401 propagate.
 */
export function useVoteOnProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      choice: _choice,
      signature,
    }: {
      id: string;
      choice: VoteChoice;
      signature?: string;
    }) => {
      if (!isAuthenticated()) {
        throw new Error("Please log in to vote.");
      }
      try {
        return await (api.voteOnProposal(id, signature) as Promise<unknown>);
      } catch (error) {
        rethrowAuthError(error, "Failed to cast vote.");
      }
    },
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
    mutationFn: async (id: string) => {
      if (!isAuthenticated()) {
        throw new Error("Please log in to execute proposals.");
      }
      try {
        return await (api.executeProposal(id) as Promise<unknown>);
      } catch (error) {
        rethrowAuthError(error, "Failed to execute proposal.");
      }
    },
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
    mutationFn: async (id: string) => {
      if (!isAuthenticated()) {
        throw new Error("Please log in to start voting.");
      }
      try {
        return await (api.startVoting(id) as Promise<unknown>);
      } catch (error) {
        rethrowAuthError(error, "Failed to start voting.");
      }
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: GOVERNANCE_KEYS.proposals() });
      qc.invalidateQueries({ queryKey: GOVERNANCE_KEYS.proposal(id) });
    },
  });
}

/** Create a new governance proposal */
export function useCreateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      if (!isAuthenticated()) {
        throw new Error("Please log in to create a proposal.");
      }
      try {
        return await (api.createProposal(data) as Promise<unknown>);
      } catch (error) {
        rethrowAuthError(error, "Failed to create proposal.");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GOVERNANCE_KEYS.proposals() });
    },
  });
}
