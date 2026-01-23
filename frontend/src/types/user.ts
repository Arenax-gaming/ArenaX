// User-related types
export interface User {
  id: string;
  username: string;
  email: string;
  isVerified: boolean;
  createdAt: string;
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