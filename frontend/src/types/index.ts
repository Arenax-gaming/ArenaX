// Export all types
export * from './achievement';
export * from './admin';
export * from './bracket';
export * from './leaderboard';
export * from './match';
export * from './notification';
export * from './player';
export * from './profile';
export * from './social';
export * from './tournament';
export * from './transaction';
export * from './user';
export * from './table';
export * from './collaboration';

// Common API response types
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiError {
  error: string;
  message: string;
  code: string;
}

// Common utility types
export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}