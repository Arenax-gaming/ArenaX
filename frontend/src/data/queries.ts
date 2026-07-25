/**
 * ArenaX TanStack Query Hooks — Issue #693
 *
 * Deterministic caching layer built on TanStack Query v5.
 * All query keys are exported as constants to enable precise cache invalidation.
 *
 * Covers:
 * - Tournaments  (list + detail + participants)
 * - Matches      (list + detail + active)
 * - Profile      (current user + public)
 * - Leaderboard
 * - Notifications
 * - Governance
 * - Wallet
 * - Disputes / Audit logs (admin)
 */

"use client";

import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
  type InfiniteData,
} from "@tanstack/react-query";
import { apiClient } from "./apiClient";
import type { ApiResponse, PaginatedResponse } from "@/types";
import type { MatchWithPlayers } from "@/types/match";
import type { Tournament } from "@/types/tournament";

// ─── Query Keys (type-safe constant map) ──────────────────────────────────────

export const QK = {
  // Tournaments
  tournaments: {
    all: ["tournaments"] as const,
    list: (params?: Record<string, unknown>) => ["tournaments", "list", params] as const,
    detail: (id: string) => ["tournaments", id] as const,
    participants: (id: string) => ["tournaments", id, "participants"] as const,
  },
  // Matches
  matches: {
    all: ["matches"] as const,
    list: (params?: Record<string, unknown>) => ["matches", "list", params] as const,
    detail: (id: string) => ["matches", id] as const,
    active: ["matches", "active"] as const,
  },
  // Profile / User
  profile: {
    me: ["profile", "me"] as const,
    public: (id: string) => ["profile", "public", id] as const,
  },
  // Leaderboard
  leaderboard: {
    all: ["leaderboard"] as const,
    byPeriod: (period: string) => ["leaderboard", period] as const,
  },
  // Notifications
  notifications: {
    all: ["notifications"] as const,
  },
  // Governance
  governance: {
    all: ["governance"] as const,
    detail: (id: string) => ["governance", id] as const,
  },
  // Wallet
  wallet: {
    balance: ["wallet", "balance"] as const,
    transactions: (params?: Record<string, unknown>) => ["wallet", "transactions", params] as const,
  },
  // Admin
  admin: {
    disputes: (params?: Record<string, unknown>) => ["admin", "disputes", params] as const,
    auditLogs: (params?: Record<string, unknown>) => ["admin", "auditLogs", params] as const,
    kycReviews: (params?: Record<string, unknown>) => ["admin", "kycReviews", params] as const,
  },
} as const;

// ─── Stale-time constants ─────────────────────────────────────────────────────

const STALE = {
  SHORT: 15_000,      // 15 s — live data (active matches, notifications)
  MEDIUM: 60_000,     // 1 min — semi-live (leaderboard, active tournaments)
  LONG: 5 * 60_000,   // 5 min — mostly static (profiles, governance)
  IMMUTABLE: Infinity, // Never re-fetch (e.g. historical records)
} as const;

// ─── Cache invalidation helpers ───────────────────────────────────────────────

export function useCacheInvalidation() {
  const qc = useQueryClient();

  return {
    invalidateTournaments: () => qc.invalidateQueries({ queryKey: QK.tournaments.all }),
    invalidateTournament: (id: string) => qc.invalidateQueries({ queryKey: QK.tournaments.detail(id) }),
    invalidateMatches: () => qc.invalidateQueries({ queryKey: QK.matches.all }),
    invalidateMatch: (id: string) => qc.invalidateQueries({ queryKey: QK.matches.detail(id) }),
    invalidateProfile: () => qc.invalidateQueries({ queryKey: QK.profile.me }),
    invalidateNotifications: () => qc.invalidateQueries({ queryKey: QK.notifications.all }),
    invalidateLeaderboard: () => qc.invalidateQueries({ queryKey: QK.leaderboard.all }),
    invalidateWallet: () => qc.invalidateQueries({ queryKey: QK.wallet.balance }),
    invalidateGovernance: () => qc.invalidateQueries({ queryKey: QK.governance.all }),
    invalidateAll: () => qc.invalidateQueries(),
  };
}

// ─── Tournaments ──────────────────────────────────────────────────────────────

export type TournamentParams = {
  page?: number;
  limit?: number;
  status?: string;
  gameType?: string;
  search?: string;
};

export function useTournaments(
  params?: TournamentParams,
  options?: Partial<UseQueryOptions<PaginatedResponse<Tournament>>>,
) {
  return useQuery<PaginatedResponse<Tournament>>({
    queryKey: QK.tournaments.list(params),
    queryFn: async () => {
      const p: Record<string, string> = {};
      if (params?.page != null) p["page"] = String(params.page);
      if (params?.limit != null) p["limit"] = String(params.limit);
      if (params?.status) p["status"] = params.status;
      if (params?.gameType) p["gameType"] = params.gameType;
      if (params?.search) p["search"] = params.search;
      return apiClient.getPaginated<Tournament>("/tournaments", { params: p });
    },
    staleTime: STALE.MEDIUM,
    ...options,
  });
}

export function useTournament(id: string, options?: Partial<UseQueryOptions<Tournament>>) {
  return useQuery<Tournament>({
    queryKey: QK.tournaments.detail(id),
    queryFn: () => apiClient.getEnveloped<Tournament>(`/tournaments/${id}`),
    staleTime: STALE.MEDIUM,
    enabled: Boolean(id),
    ...options,
  });
}

export function useTournamentParticipants(id: string) {
  return useQuery({
    queryKey: QK.tournaments.participants(id),
    queryFn: () => apiClient.getEnveloped(`/tournaments/${id}/participants`),
    staleTime: STALE.SHORT,
    enabled: Boolean(id),
  });
}

export function useJoinTournament(
  options?: UseMutationOptions<unknown, Error, string>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/tournaments/${id}/register`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: QK.tournaments.detail(id) });
      qc.invalidateQueries({ queryKey: QK.tournaments.all });
    },
    ...options,
  });
}

export function useCreateTournament(
  options?: UseMutationOptions<Tournament, Error, Partial<Tournament>>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Tournament>) => apiClient.post<Tournament>("/tournaments", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.tournaments.all });
    },
    ...options,
  });
}

// ─── Infinite tournaments list ────────────────────────────────────────────────

export function useInfiniteTournaments(params?: Omit<TournamentParams, "page">) {
  return useInfiniteQuery<PaginatedResponse<Tournament>, Error, InfiniteData<PaginatedResponse<Tournament>>, ReturnType<typeof QK.tournaments.list>, number>({
    queryKey: QK.tournaments.list(params),
    queryFn: ({ pageParam = 1 }) => {
      const p: Record<string, string> = { page: String(pageParam), limit: "20" };
      if (params?.status) p["status"] = params.status;
      if (params?.gameType) p["gameType"] = params.gameType;
      if (params?.search) p["search"] = params.search;
      return apiClient.getPaginated<Tournament>("/tournaments", { params: p });
    },
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    staleTime: STALE.MEDIUM,
  });
}

// ─── Matches ──────────────────────────────────────────────────────────────────

export type MatchParams = {
  page?: number;
  limit?: number;
  status?: string;
  mine?: boolean;
};

export function useMatches(params?: MatchParams, options?: Partial<UseQueryOptions<PaginatedResponse<MatchWithPlayers>>>) {
  return useQuery<PaginatedResponse<MatchWithPlayers>>({
    queryKey: QK.matches.list(params),
    queryFn: () => {
      const p: Record<string, string> = {};
      if (params?.page != null) p["page"] = String(params.page);
      if (params?.limit != null) p["limit"] = String(params.limit);
      if (params?.status) p["status"] = params.status;
      if (params?.mine) p["mine"] = "true";
      return apiClient.getPaginated<MatchWithPlayers>("/matches", { params: p });
    },
    staleTime: STALE.SHORT,
    ...options,
  });
}

export function useMatch(id: string, options?: Partial<UseQueryOptions<MatchWithPlayers>>) {
  return useQuery<MatchWithPlayers>({
    queryKey: QK.matches.detail(id),
    queryFn: () => apiClient.getEnveloped<MatchWithPlayers>(`/matches/${id}`),
    staleTime: STALE.SHORT,
    enabled: Boolean(id),
    ...options,
  });
}

export function useActiveMatches() {
  return useQuery<MatchWithPlayers[]>({
    queryKey: QK.matches.active,
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<MatchWithPlayers[]> | MatchWithPlayers[]>(
        "/matches",
        { params: { status: "in_progress", mine: "true" } },
      );
      if (Array.isArray(res)) return res;
      return (res as ApiResponse<MatchWithPlayers[]>).data ?? [];
    },
    staleTime: STALE.SHORT,
    refetchInterval: STALE.SHORT,
  });
}

export function useReportMatchScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, result }: { id: string; result: unknown }) =>
      apiClient.post(`/matches/${id}/report`, result),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: QK.matches.detail(id) });
      qc.invalidateQueries({ queryKey: QK.matches.active });
    },
  });
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  is_verified: boolean;
  created_at: string;
  elo?: number;
  avatar?: string;
  bio?: string;
}

export function useCurrentProfile(options?: Partial<UseQueryOptions<UserProfile>>) {
  return useQuery<UserProfile>({
    queryKey: QK.profile.me,
    queryFn: async () => {
      const res = await apiClient.get<ApiResponse<UserProfile> | UserProfile>("/users/me");
      if ("data" in (res as object) && (res as ApiResponse<UserProfile>).data) {
        return (res as ApiResponse<UserProfile>).data;
      }
      return res as UserProfile;
    },
    staleTime: STALE.LONG,
    ...options,
  });
}

export function usePublicProfile(id: string, options?: Partial<UseQueryOptions<UserProfile>>) {
  return useQuery<UserProfile>({
    queryKey: QK.profile.public(id),
    queryFn: () => apiClient.getEnveloped<UserProfile>(`/users/${id}`),
    staleTime: STALE.LONG,
    enabled: Boolean(id),
    ...options,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<UserProfile>) => apiClient.patch("/users/me", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK.profile.me });
    },
  });
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export function useLeaderboard(period = "weekly") {
  return useQuery({
    queryKey: QK.leaderboard.byPeriod(period),
    queryFn: () => apiClient.get(`/leaderboard`, { params: { period } }),
    staleTime: STALE.MEDIUM,
    refetchInterval: STALE.MEDIUM,
  });
}

// ─── Notifications ────────────────────────────────────────────────────────────

export interface ApiNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  linkLabel?: string;
  read: boolean;
  createdAt: string;
}

export function useNotifications(options?: Partial<UseQueryOptions<ApiNotification[]>>) {
  return useQuery<ApiNotification[]>({
    queryKey: QK.notifications.all,
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiResponse<ApiNotification[]> | ApiNotification[]>("/notifications");
        if (Array.isArray(res)) return res;
        return (res as ApiResponse<ApiNotification[]>).data ?? [];
      } catch {
        return [];
      }
    },
    staleTime: STALE.SHORT,
    refetchInterval: STALE.SHORT,
    ...options,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.notifications.all }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.patch("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: QK.notifications.all }),
  });
}

// ─── Governance ───────────────────────────────────────────────────────────────

export function useProposals() {
  return useQuery({
    queryKey: QK.governance.all,
    queryFn: async () => {
      try {
        const res = await apiClient.get<ApiResponse<unknown[]> | unknown[]>("/governance");
        if (Array.isArray(res)) return res;
        return (res as ApiResponse<unknown[]>).data ?? [];
      } catch {
        return [];
      }
    },
    staleTime: STALE.LONG,
  });
}

export function useProposal(id: string) {
  return useQuery({
    queryKey: QK.governance.detail(id),
    queryFn: () => apiClient.get(`/governance/${id}`),
    staleTime: STALE.LONG,
    enabled: Boolean(id),
  });
}

export function useVoteOnProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, signature }: { id: string; signature?: string }) =>
      apiClient.post(`/governance/${id}/vote`, { signature }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: QK.governance.detail(id) });
      qc.invalidateQueries({ queryKey: QK.governance.all });
    },
  });
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export function useDisputes(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: QK.admin.disputes(params),
    queryFn: () => {
      const p: Record<string, string> = {};
      if (params) Object.entries(params).forEach(([k, v]) => { if (v != null) p[k] = String(v); });
      return apiClient.get("/admin/disputes", { params: p });
    },
    staleTime: STALE.SHORT,
  });
}

export function useResolveDispute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { status: string; resolution: string; winnerOverrideId?: string } }) =>
      apiClient.post(`/admin/disputes/${id}/resolve`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "disputes"] }),
  });
}

export function useAuditLogs(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: QK.admin.auditLogs(params),
    queryFn: () => {
      const p: Record<string, string> = {};
      if (params) Object.entries(params).forEach(([k, v]) => { if (v != null) p[k] = String(v); });
      return apiClient.get("/admin/audit-logs", { params: p });
    },
    staleTime: STALE.MEDIUM,
  });
}
