// Match-related types
export interface Match {
  id: string;
  tournamentId?: string;
  player1Id: string;
  player2Id: string;
  gameType: string;
  status: MatchStatus;
  winnerId?: string;
  scorePlayer1?: number;
  scorePlayer2?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export type MatchStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'disputed'
  | 'cancelled';

export interface MatchWithPlayers extends Match {
  player1Username: string;
  player2Username: string;
  tournamentName?: string;
}

export interface MatchResult {
  matchId: string;
  winnerId: string;
  scorePlayer1: number;
  scorePlayer2: number;
}

export interface MatchFilters {
  tournamentId?: string;
  playerId?: string;
  status?: MatchStatus;
  gameType?: string;
  page?: number;
  limit?: number;
}