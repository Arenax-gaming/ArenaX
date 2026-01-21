import { ApiResponse, ApiError } from "../types";

class ApiClient {
  private baseURL: string;

  constructor(baseURL: string = "/api") {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    // Add authorization header if token exists
    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

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

  // Auth endpoints
  async login(credentials: { email: string; password: string }) {
    return this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    });
  }

  async register(userData: {
    username: string;
    email: string;
    password: string;
  }) {
    return this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify(userData),
    });
  }

  // Tournament endpoints
  async getTournaments(params?: Record<string, any>) {
    const queryString = params ? "?" + new URLSearchParams(params) : "";
    return this.request(`/tournaments${queryString}`);
  }

  async getTournament(id: string) {
    return this.request(`/tournaments/${id}`);
  }

  async createTournament(tournament: any) {
    return this.request("/tournaments", {
      method: "POST",
      body: JSON.stringify(tournament),
    });
  }

  async joinTournament(id: string) {
    return this.request(`/tournaments/${id}/join`, {
      method: "POST",
    });
  }

  // Match endpoints
  async getMatches(params?: Record<string, any>) {
    const queryString = params ? "?" + new URLSearchParams(params) : "";
    return this.request(`/matches${queryString}`);
  }

  async getMatch(id: string) {
    return this.request(`/matches/${id}`);
  }

  async reportMatchScore(id: string, result: any) {
    return this.request(`/matches/${id}/report`, {
      method: "POST",
      body: JSON.stringify(result),
    });
  }

  // Health check
  async healthCheck() {
    return this.request("/health");
  }
}

export const api = new ApiClient();
