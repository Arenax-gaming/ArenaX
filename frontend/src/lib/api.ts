import { ApiResponse, ApiError } from "../types";
import {
  Tournament,
  CreateTournamentRequest,
  TournamentFilters,
} from "../types/tournament";
import {
  Match,
  MatchFilters,
  ReportScoreRequest,
} from "../types/match";
import {
  Proposal,
  CreateProposalDto,
} from "../types/governance";
import {
  Dispute,
  ResolveDisputePayload,
  AuditLog,
  AuditLogFilters,
  PaginatedAuditLogs,
  KycReview,
  KycFilters,
  ProcessKycPayload,
} from "../types/admin";
import {
  Achievement,
  PlayerAchievementsResponse,
  AchievementStats,
  AchievementUnlockedEvent,
  ShareAchievementResponse,
} from "../types/achievement";
import {
  LeaderboardResponse,
  PlayerRankResponse,
  RankHistory,
  SeasonalLeaderboard,
  LeaderboardStats,
} from "../types/leaderboard";
import {
  Friend,
  FriendRequest,
  Message,
  Conversation,
  Party,
  OnlineStatus,
  FriendsListResponse,
  SocialUser,
} from "../types/social";
import { AuthApiError } from "./authErrors";
import { API_BASE } from "./constants";
import { pinnedFetch } from "../api/certificatePinning";

// ---------------------------------------------------------------------------
// ApiClient
//
// Tokens are stored exclusively in httpOnly cookies set by the server.
// This file never reads or writes localStorage / sessionStorage for auth.
// All fetch calls use `credentials: "include"` so the browser automatically
// attaches the auth_token and auth_refresh_token cookies.
// ---------------------------------------------------------------------------

class ApiClient {
  private baseURL: string;

  // Shared in-flight refresh promise so parallel 401s share a single call.
  private refreshPromise: Promise<number> | null = null;
  public isRefreshing = false;

  // Callback set by useAuth so the client can trigger logout + redirect when
  // a refresh attempt itself fails.
  private onAuthFailure?: () => void;

  constructor(baseURL: string = "/api") {
    this.baseURL = baseURL;
  }

  /** Called once by AuthProvider so the client knows how to log the user out. */
  setOnAuthFailure(callback: () => void): void {
    this.onAuthFailure = callback;
  }

  /**
   * Silently refresh the access token.
   *
   * The browser sends the `auth_refresh_token` cookie automatically.
   * The server validates it, rotates both cookies (access + refresh), and
   * returns `{ expires_in }`.
   *
   * Returns the new access token TTL in seconds (useful for scheduling the
   * next proactive refresh).  Multiple concurrent callers share one request.
   */
  async refreshAccessToken(): Promise<number> {
    if (this.refreshPromise) return this.refreshPromise;

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      const url = `${this.baseURL}/auth/refresh`;
      const response = await pinnedFetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // No body needed — the refresh token arrives as a cookie.
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error("Refresh failed");
      }

      const data = await response.json() as { expires_in: number };
      return data.expires_in ?? 900;
    })().finally(() => {
      this.isRefreshing = false;
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    _isRetry = false,
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    const response = await pinnedFetch(url, {
      ...options,
      headers,
      // Always include cookies — the httpOnly auth_token cookie carries the
      // JWT; no Authorization header is needed.
      credentials: "include",
    });

    // Intercept 401 — attempt a silent token refresh and retry once.
    if (response.status === 401 && !_isRetry) {
      try {
        await this.refreshAccessToken();
      } catch {
        // Refresh itself failed — session is unrecoverable.
        this.onAuthFailure?.();
        throw new Error("SESSION_EXPIRED");
      }
      return this.request<T>(endpoint, options, true);
    }

    if (!response.ok) {
      const errorData: ApiError = await response.json().catch(() => ({
        error: "Request failed",
        message: `HTTP ${response.status}`,
        code: "REQUEST_FAILED",
      }));
      throw new Error(errorData.message);
    }

    const data: ApiResponse<T> = await response.json();
    return data.data;
  }

  /**
   * Auth endpoints return `{ user, expires_in }` directly (no `.data` wrapper).
   * Tokens are delivered as httpOnly cookies — this method never sees them.
   */
  private async authRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    const response = await pinnedFetch(url, {
      ...options,
      headers,
      credentials: "include",
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message =
        (json as { error?: { message?: string } })?.error?.message ??
        (json as { message?: string })?.message ??
        `HTTP ${response.status}`;
      const code =
        (json as { error?: { code?: string } })?.error?.code ??
        (json as { code?: string })?.code ??
        "UNKNOWN";
      throw new AuthApiError(message, code);
    }
    return json as T;
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  /**
   * POST /api/auth/login
   *
   * Server sets `auth_token` + `auth_refresh_token` httpOnly cookies.
   * Response body: `{ user, expires_in }`.
   */
  async login(credentials: { email: string; password: string }) {
    return this.authRequest<{
      user: unknown;
      expires_in: number;
    }>("/auth/login", { method: "POST", body: JSON.stringify(credentials) });
  }

  /**
   * POST /api/auth/register
   *
   * Same cookie behaviour as login.
   * Response body: `{ user, expires_in }`.
   */
  async register(userData: {
    username: string;
    email: string;
    password: string;
  }) {
    return this.authRequest<{
      user: unknown;
      expires_in: number;
    }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(userData),
    });
  }

  /**
   * POST /api/auth/logout
   *
   * Server blacklists the current access token and clears both cookies.
   */
  async logout() {
    return this.authRequest<{ message: string }>("/auth/logout", {
      method: "POST",
    });
  }

  /**
   * GET /api/auth/ws-token
   *
   * Returns a 60-second token for the initial WebSocket auth message.
   * Must be called immediately before opening the socket.
   */
  async getWsToken(): Promise<{ ws_token: string; expires_in: number }> {
    return this.authRequest<{ ws_token: string; expires_in: number }>(
      "/auth/ws-token",
    );
  }

  /** Check whether a username is available for registration/profile updates. */
  async checkUsernameAvailability(
    username: string,
    signal?: AbortSignal,
  ): Promise<{ available: boolean }> {
    return this.request<{ available: boolean }>(
      `/auth/check-username?username=${encodeURIComponent(username)}`,
      { signal },
    );
  }

  async verifyEmail(token: string) {
    return this.authRequest<{ message: string }>("/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  }

  async resendVerificationEmail(email: string) {
    return this.authRequest<{ message: string }>(
      "/auth/resend-verification-email",
      { method: "POST", body: JSON.stringify({ email }) },
    );
  }

  // ── User / Profile ───────────────────────────────────────────────────────────

  async getProfile() {
    return this.request<{
      id: string;
      username: string;
      email: string | null;
      is_verified: boolean;
      created_at: string;
      elo?: number;
      bio?: string;
      avatar?: string;
      global_rank?: number;
      current_streak?: number;
      wins?: number;
      losses?: number;
    }>("/users/me");
  }

  async updateProfile(data: {
    username?: string;
    bio?: string;
    avatar?: string;
    socialLinks?: {
      twitter?: string;
      discord?: string;
      twitch?: string;
      github?: string;
    };
  }) {
    return this.request<{
      id: string;
      username: string;
      email: string | null;
      is_verified: boolean;
      created_at: string;
      elo?: number;
      bio?: string;
      avatar?: string;
    }>("/users/me", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async getProfileStats() {
    return this.request<{
      elo: number;
      global_rank: number;
      wins: number;
      losses: number;
      win_rate: number;
      current_streak: number;
    }>("/users/me/stats");
  }

  async getJoinedTournaments() {
    return this.request<{ id: string }[]>("/users/me/tournaments");
  }

  /** Fetch the session detail used by the lobby page. */
  async getMatchSession(sessionId: string): Promise<{
    session_id: string;
    game_mode: string;
    status: string;
    players: Array<{
      id: string;
      username: string;
      elo_rating: number;
      avatar_url?: string;
      is_ready: boolean;
    }>;
    created_at: string;
  }> {
    return this.request(`/matchmaking/sessions/${sessionId}`);
  }

  /** Mark the current user as ready in a lobby session. */
  async readyUp(sessionId: string): Promise<{ success: boolean }> {
    return this.request(`/matchmaking/sessions/${sessionId}/ready`, {
      method: "POST",
    });
  }

  // ── Tournaments ──────────────────────────────────────────────────────────────

  async getTournaments(params?: TournamentFilters): Promise<Tournament[]> {
    const queryString = params
      ? "?" + new URLSearchParams(params as Record<string, string>)
      : "";
    return this.request<Tournament[]>(`/tournaments${queryString}`);
  }

  async getTournament(id: string): Promise<Tournament> {
    return this.request<Tournament>(`/tournaments/${id}`);
  }

  async createTournament(
    tournament: CreateTournamentRequest,
  ): Promise<Tournament> {
    return this.request<Tournament>("/tournaments", {
      method: "POST",
      body: JSON.stringify(tournament),
    });
  }

  async joinTournament(id: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/tournaments/${id}/register`, {
      method: "POST",
    });
  }

  // ── Matches ──────────────────────────────────────────────────────────────────

  async getMatches(params?: MatchFilters): Promise<Match[]> {
    const queryString = params
      ? "?" + new URLSearchParams(params as Record<string, string>)
      : "";
    return this.request<Match[]>(`/matches${queryString}`);
  }

  async getMatch(id: string): Promise<Match> {
    return this.request<Match>(`/matches/${id}`);
  }

  async reportMatchScore(
    id: string,
    result: ReportScoreRequest,
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/matches/${id}/report`, {
      method: "POST",
      body: JSON.stringify(result),
    });
  }

  // ── Health ───────────────────────────────────────────────────────────────────

  async healthCheck() {
    return this.request("/health");
  }

  // ── Notifications ─────────────────────────────────────────────────────────────

  async getNotifications(params?: {
    offset?: number;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      link?: string;
      linkLabel?: string;
      read: boolean;
      createdAt: string;
    }>
  > {
    try {
      const query = new URLSearchParams();
      if (params?.offset !== undefined)
        query.set("offset", String(params.offset));
      if (params?.limit !== undefined) query.set("limit", String(params.limit));
      const qs = query.toString();
      return await this.request(`/notifications${qs ? `?${qs}` : ""}`);
    } catch {
      return [];
    }
  }

  async createNotification(data: {
    type: string;
    title: string;
    message: string;
    link?: string;
    linkLabel?: string;
  }) {
    return this.request("/notifications", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async markNotificationRead(id: string) {
    return this.request(`/notifications/${id}/read`, { method: "PATCH" });
  }

  async markAllNotificationsRead() {
    return this.request("/notifications/read-all", { method: "PATCH" });
  }

  async deleteNotification(id: string) {
    return this.request(`/notifications/${id}`, { method: "DELETE" });
  }

  // ── Governance ───────────────────────────────────────────────────────────────

  async getProposals(): Promise<Proposal[]> {
    try {
      return await this.request<Proposal[]>("/governance");
    } catch {
      return [];
    }
  }

  async getProposal(id: string): Promise<Proposal> {
    return this.request<Proposal>(`/governance/${id}`);
  }

  async createProposal(data: CreateProposalDto): Promise<Proposal> {
    return this.request<Proposal>("/governance", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async startVoting(id: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/governance/${id}/start-voting`,
      { method: "POST" },
    );
  }

  async voteOnProposal(
    id: string,
    signature?: string,
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/governance/${id}/vote`, {
      method: "POST",
      body: JSON.stringify({ signature }),
    });
  }

  async executeProposal(id: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/governance/${id}/execute`, {
      method: "POST",
    });
  }

  // ── Admin / Disputes ──────────────────────────────────────────────────────────

  async getDisputes(): Promise<Dispute[]> {
    return this.request<Dispute[]>("/admin/disputes");
  }

  async resolveDispute(
    id: string,
    data: ResolveDisputePayload,
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/admin/disputes/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getActiveMatches(): Promise<
    import("../types/match").MatchWithPlayers[]
  > {
    try {
      return await this.request<import("../types/match").MatchWithPlayers[]>(
        "/matches?status=in_progress&mine=true",
      );
    } catch {
      return [];
    }
  }

  async getAuditLogs(params?: AuditLogFilters): Promise<PaginatedAuditLogs> {
    const queryString = params
      ? "?" + new URLSearchParams(params as Record<string, string>)
      : "";
    return this.request<PaginatedAuditLogs>(`/admin/audit-logs${queryString}`);
  }

  async getKycReviews(params?: KycFilters): Promise<KycReview[]> {
    const queryString = params
      ? "?" + new URLSearchParams(params as Record<string, string>)
      : "";
    return this.request<KycReview[]>(`/admin/kyc${queryString}`);
  }

  async getKycReview(id: string): Promise<KycReview> {
    return this.request<KycReview>(`/admin/kyc/${id}`);
  }

  async processKycReview(
    id: string,
    data: ProcessKycPayload,
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/admin/kyc/${id}/process`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // ── Social / Friends ──────────────────────────────────────────────────────────

  async getFriendsList(): Promise<FriendsListResponse> {
    return this.request<FriendsListResponse>("/v1/friends");
  }

  async getPendingFriendRequests(): Promise<FriendRequest[]> {
    return this.request<FriendRequest[]>("/v1/friends/requests");
  }

  async getSuggestedUsers(): Promise<SocialUser[]> {
    return this.request<SocialUser[]>("/v1/friends/suggested");
  }

  async addFriend(friendId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("/v1/friends/add", {
      method: "POST",
      body: JSON.stringify({ user_id: friendId }),
    });
  }

  async acceptFriendRequest(requestId: string): Promise<{ message: string }> {
    return this.request<{ message: string }>("/v1/friends/requests/accept", {
      method: "POST",
      body: JSON.stringify({ request_id: requestId }),
    });
  }

  async sendMessage(
    toUserId: string,
    content: string,
  ): Promise<Message> {
    return this.request<Message>("/v1/messages/send", {
      method: "POST",
      body: JSON.stringify({ to_user_id: toUserId, content }),
    });
  }

  async getConversations(): Promise<Conversation[]> {
    return this.request<Conversation[]>("/v1/messages/conversations");
  }

  async createParty(data: {
    name: string;
    description?: string;
    maxMembers?: number;
  }): Promise<Party> {
    return this.request<Party>("/v1/party/create", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getOnlineStatus(userId: string): Promise<OnlineStatus> {
    return this.request<OnlineStatus>(`/v1/status/${userId}`);
  }

  // ── Achievements ───────────────────────────────────────────────────────────────

  async getAchievements(): Promise<Achievement[]> {
    return this.request<Achievement[]>("/v1/achievements");
  }

  async getPlayerAchievements(
    playerId: string,
  ): Promise<PlayerAchievementsResponse> {
    return this.request<PlayerAchievementsResponse>(
      `/v1/achievements/player/${playerId}`,
    );
  }

  async getAchievementStats(
    achievementId: string,
  ): Promise<AchievementStats> {
    return this.request<AchievementStats>(
      `/v1/achievements/${achievementId}/stats`,
    );
  }

  async updateAchievementProgress(
    achievementId: string,
    progress: number,
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/v1/achievements/${achievementId}/progress`,
      {
        method: "POST",
        body: JSON.stringify({ progress }),
      },
    );
  }

  async shareAchievement(
    achievementId: string,
  ): Promise<ShareAchievementResponse> {
    return this.request<ShareAchievementResponse>(
      `/v1/achievements/${achievementId}/share`,
      { method: "POST" },
    );
  }

  async checkAchievements(
    eventType: string,
    eventData: Record<string, unknown>,
  ): Promise<AchievementUnlockedEvent[]> {
    return this.request<AchievementUnlockedEvent[]>("/v1/achievements/check", {
      method: "POST",
      body: JSON.stringify({ event_type: eventType, event_data: eventData }),
    });
  }

  // ── Leaderboards ───────────────────────────────────────────────────────────────

  async getLeaderboard(
    category: string,
    limit = 100,
    offset = 0,
    season?: string,
    search?: string,
  ): Promise<LeaderboardResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (season) params.set("season", season);
    if (search) params.set("search", search);
    return this.request<LeaderboardResponse>(
      `/v1/leaderboards/${category}?${params.toString()}`,
    );
  }

  async getSeasonalLeaderboard(
    category: string,
    season: string,
    limit = 100,
    offset = 0,
  ): Promise<SeasonalLeaderboard> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    return this.request<SeasonalLeaderboard>(
      `/v1/leaderboards/${category}/season/${season}?${params.toString()}`,
    );
  }

  async getPlayerRank(
    category: string,
    playerId: string,
  ): Promise<PlayerRankResponse> {
    return this.request<PlayerRankResponse>(
      `/v1/leaderboards/${category}/player/${playerId}`,
    );
  }

  async getRankHistory(
    category: string,
    playerId: string,
    days = 30,
  ): Promise<RankHistory> {
    return this.request<RankHistory>(
      `/v1/leaderboards/${category}/history/${playerId}?days=${days}`,
    );
  }

  async getLeaderboardStats(category: string): Promise<LeaderboardStats> {
    return this.request<LeaderboardStats>(
      `/v1/leaderboards/${category}/stats`,
    );
  }

  async refreshLeaderboard(category: string): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/v1/leaderboards/${category}/refresh`,
      { method: "POST" },
    );
  }

  // ── Settings ──────────────────────────────────────────────────────────────────

  async getSettings(): Promise<any> {
    return this.request("/users/me/settings");
  }

  async updateSettings(data: any): Promise<any> {
    return this.request("/users/me/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }
}

export const api = new ApiClient();
