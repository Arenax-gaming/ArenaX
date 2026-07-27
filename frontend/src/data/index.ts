/**
 * ArenaX Data Layer — public barrel
 *
 * Import from "@/data" for API client, query hooks, and cache utilities.
 */

export { apiClient, EnhancedApiClient, getRequestMetrics, getMetricsSummary, clearMetrics } from "./apiClient";
export type { RequestOptions, ClientConfig, RequestMetrics } from "./apiClient";

export {
  QK,
  useCacheInvalidation,
  // Tournaments
  useTournaments,
  useTournament,
  useTournamentParticipants,
  useJoinTournament,
  useCreateTournament,
  useInfiniteTournaments,
  // Matches
  useMatches,
  useMatch,
  useActiveMatches,
  useReportMatchScore,
  // Profile
  useCurrentProfile,
  usePublicProfile,
  useUpdateProfile,
  // Leaderboard
  useLeaderboard,
  // Notifications
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  // Governance
  useProposals,
  useProposal,
  useVoteOnProposal,
  // Admin
  useDisputes,
  useResolveDispute,
  useAuditLogs,
} from "./queries";

export type { TournamentParams, MatchParams, UserProfile, ApiNotification } from "./queries";
