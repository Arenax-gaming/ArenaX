/**
 * Hook for fetching player reputation data from the backend.
 *
 * Backend endpoints (reputation_handler.rs):
 *   GET /api/v1/reputation/player/:userId  — public reputation for any user
 *   GET /api/v1/reputation/me              — authenticated user's own reputation
 *   GET /api/v1/reputation/history/:userId — paginated reputation event history
 */
import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReputationTier = "elite" | "good" | "average" | "poor";

export interface ReputationData {
  user_id: string;
  skill_score: number;
  fair_play_score: number;
  is_bad_actor: boolean;
  tier: ReputationTier;
  last_updated: string | null;
}

export interface ReputationEvent {
  id: string;
  user_id: string;
  event_type: string;
  skill_delta: number;
  fair_play_delta: number;
  match_id: string | null;
  transaction_hash: string | null;
  created_at: string;
}

export interface ReputationHistoryResponse {
  data: ReputationEvent[];
  total: number;
  page: number;
  per_page: number;
}

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

export const TIER_CONFIG: Record<
  ReputationTier,
  { label: string; color: string; bgColor: string; description: string }
> = {
  elite: {
    label: "Elite",
    color: "text-yellow-500",
    bgColor: "bg-yellow-500/10 border-yellow-500/30",
    description: "Outstanding fair play and performance",
  },
  good: {
    label: "Good",
    color: "text-green-500",
    bgColor: "bg-green-500/10 border-green-500/30",
    description: "Consistent fair play record",
  },
  average: {
    label: "Average",
    color: "text-blue-500",
    bgColor: "bg-blue-500/10 border-blue-500/30",
    description: "Standard fair play standing",
  },
  poor: {
    label: "Poor",
    color: "text-red-500",
    bgColor: "bg-red-500/10 border-red-500/30",
    description: "Fair play issues detected",
  },
};

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const REPUTATION_KEYS = {
  all: ["reputation"] as const,
  player: (userId: string) => ["reputation", "player", userId] as const,
  me: () => ["reputation", "me"] as const,
  history: (userId: string, page?: number) =>
    ["reputation", "history", userId, page] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Fetch reputation for any public user by ID */
export function useReputation(userId: string) {
  return useQuery<ReputationData>({
    queryKey: REPUTATION_KEYS.player(userId),
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/reputation/player/${userId}`);
      if (!res.ok) throw new Error("Failed to fetch reputation");
      const json = await res.json();
      // Backend wraps response in { success, data }
      return (json.data ?? json) as ReputationData;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}

/** Fetch the authenticated user's own reputation */
export function useMyReputation() {
  return useQuery<ReputationData>({
    queryKey: REPUTATION_KEYS.me(),
    queryFn: async () => {
      const token =
        localStorage.getItem("auth_token") ??
        sessionStorage.getItem("auth_token");
      const res = await fetch(`${API_BASE}/reputation/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Failed to fetch reputation");
      const json = await res.json();
      return (json.data ?? json) as ReputationData;
    },
    staleTime: 60_000,
  });
}

/** Fetch paginated reputation event history for a user */
export function useReputationHistory(userId: string, page = 1, perPage = 20) {
  return useQuery<ReputationHistoryResponse>({
    queryKey: REPUTATION_KEYS.history(userId, page),
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      const res = await fetch(
        `${API_BASE}/reputation/history/${userId}?${params}`
      );
      if (!res.ok) throw new Error("Failed to fetch reputation history");
      return res.json() as Promise<ReputationHistoryResponse>;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}
