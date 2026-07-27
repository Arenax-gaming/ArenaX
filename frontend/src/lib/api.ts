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

const TOKEN_KEY = "auth_token";
const REFRESH_TOKEN_KEY = "auth_refresh_token";

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem(REFRESH_TOKEN_KEY) ??
    sessionStorage.getItem(REFRESH_TOKEN_KEY)
  );
}

function updateStoredTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === "undefined") return;
  // Preserve the storage location (local vs session) the user originally chose
  const inLocal = !!localStorage.getItem(TOKEN_KEY);
  const storage = inLocal ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, accessToken);
  storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

class ApiClient {
  private baseURL: string;

  // Shared in-flight refresh promise so parallel requests all await the same call
  private refreshPromise: Promise<string> | null = null;
  public isRefreshing = false;

  // Callback set by useAuth so the client can trigger logout + redirect
  private onAuthFailure?: () => void;

  constructor(baseURL: string = "/api") {
    this.baseURL = baseURL;
  }

  /** Called once by AuthProvider so the client knows how to log the user out. */
  setOnAuthFailure(callback: () => void): void {
    this.onAuthFailure = callback;
  }

  /**
   * Refresh the access token using the stored refresh token.
   * Multiple concurrent callers share the same promise so only one HTTP
   * request is made regardless of how many 401s fire simultaneously.
   */
  async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) throw new Error("No refresh token available");

      const url = `${this.baseURL}/auth/refresh`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (!response.ok) {
        throw new Error("Refresh failed");
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token: string;
      };

      updateStoredTokens(data.access_token, data.refresh_token);
      return data.access_token;
    })()
      .finally(() => {
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

    const token = getStoredToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, { ...options, headers });

    // Intercept 401 — attempt a silent token refresh and retry once
    if (response.status === 401 && !_isRetry) {
      try {
        await this.refreshAccessToken();
      } catch {
        // Refresh itself failed — session is unrecoverable
        this.onAuthFailure?.();
        throw new Error("SESSION_EXPIRED");
      }
      // Retry the original request with the new token
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

  // Auth endpoints — backend returns { user, tokens } directly (no .data wrapper)
  private async authRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };
    const response = await fetch(url, { ...options, headers });
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

  async login(credentials: { email: string; password: string }) {
    return this.authRequest<{ user: unknown; tokens: { accessToken: string; refreshToken: string } }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify(credentials) }
    );
  }

  async register(userData: {
    username: string;
    email: string;
    password: string;
  }) {
    return this.authRequest<{ user: unknown; tokens: { accessToken: string; refreshToken: string } }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify(userData) }
    );
  }

  async verifyEmail(token: string) {
    return this.authRequest<{ message: string }>(
      "/auth/verify-email",
      { method: "POST", body: JSON.stringify({ token }) }
    );
  }

  async resendVerificationEmail(email: string) {
    return this.authRequest<{ message: string }>(
      "/auth/resend-verification-email",
      { method: "POST", body: JSON.stringify({ email }) }
    );
  }

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

  // Tournament endpoints
  async getTournaments(params?: TournamentFilters): Promise<Tournament[]> {
    const queryString = params
      ? "?" + new URLSearchParams(params as Record<string, string>)
      : "";
    return this.request<Tournament[]>(`/tournaments${queryString}`);
  }

  async getTournament(id: string): Promise<Tournament> {
    return this.request<Tournament>(`/tournaments/${id}`);
  }

  async createTournament(tournament: CreateTournamentRequest): Promise<Tournament> {
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

  // Match endpoints
  async getMatches(params?: MatchFilters): Promise<Match[]> {
    const queryString = params
      ? "?" + new URLSearchParams(params as Record<string, string>)
      : "";
    return this.request<Match[]>(`/matches${queryString}`);
  }

  async getMatch(id: string): Promise<Match> {
    return this.request<Match>(`/matches/${id}`);
  }

  async reportMatchScore(id: string, result: ReportScoreRequest): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/matches/${id}/report`, {
      method: "POST",
      body: JSON.stringify(result),
    });
  }

  // Health check
  async healthCheck() {
    return this.request("/health");
  }

  // Notification endpoints (persistent, stored in DB)
  async getNotifications(params?: { offset?: number; limit?: number }): Promise<
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
      if (params?.offset !== undefined) query.set("offset", String(params.offset));
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
    return this.request(`/notifications/${id}/read`, {
      method: "PATCH",
    });
  }

  async markAllNotificationsRead() {
    return this.request("/notifications/read-all", {
      method: "PATCH",
    });
  }

  async deleteNotification(id: string) {
    return this.request(`/notifications/${id}`, {
      method: "DELETE",
    });
  }

  // Governance endpoints
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
    return this.request<{ message: string }>(`/governance/${id}/start-voting`, {
      method: "POST",
    });
  }

  async voteOnProposal(id: string, signature?: string): Promise<{ message: string }> {
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

  // Admin/Dispute endpoints
  async getDisputes(): Promise<Dispute[]> {
    return this.request<Dispute[]>("/admin/disputes");
  }

  async resolveDispute(id: string, data: ResolveDisputePayload): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/admin/disputes/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getActiveMatches(): Promise<import("../types/match").MatchWithPlayers[]> {
    try {
      return await this.request<import("../types/match").MatchWithPlayers[]>("/matches?status=in_progress&mine=true");
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

  async processKycReview(id: string, data: ProcessKycPayload): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/admin/kyc/${id}/process`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Settings endpoints
  async getSettings(): Promise<any> {
    return this.request('/users/me/settings');
  }

  async updateSettings(data: any): Promise<any> {
    return this.request('/users/me/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
}

export const api = new ApiClient();
