// User-related types
export interface User {
  id: string;
  username: string;
  email: string;
  isVerified: boolean;
  avatar?: string;
  bio?: string;
  socialLinks?: {
    twitter?: string;
    discord?: string;
    twitch?: string;
    github?: string;
  };
  elo: number;
  createdAt: string;
}

export interface EloPoint {
  date: string;
  elo: number;
}

export interface AuthUser extends User {
  token: string;
  refreshToken: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: User;
}