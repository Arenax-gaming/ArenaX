import type { BracketMatch, ScoreReport } from "./bracket";

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

// Enhanced types for detailed match view
export interface MatchRound {
  roundNumber: number;
  scorePlayer1: number;
  scorePlayer2: number;
  winner?: 'player1' | 'player2' | 'draw';
  duration?: number; // in seconds
  keyEvents?: string[];
}

export interface PlayerStats {
  playerId: string;
  username: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  accuracy?: number;
  headshotRate?: number;
  economy?: number;
  utilityDamage?: number;
  firstBloods?: number;
  clutches?: number;
  plants?: number;
  defuses?: number;
}

export interface MatchDetail extends MatchWithPlayers {
  rounds?: MatchRound[];
  player1Stats?: PlayerStats;
  player2Stats?: PlayerStats;
  scoreProgression?: Array<{ round: number; scorePlayer1: number; scorePlayer2: number }>;
  rules?: string;
  format?: string;
  prizeDistribution?: {
    winner: number;
    loser: number;
    currency?: string;
  };
  tournamentBracketId?: string;
  replayUrl?: string;
  canDispute?: boolean;
  disputeDeadline?: string;
}

export interface MatchHubEvent {
  id: string;
  type: "status" | "score" | "alert" | "report";
  message: string;
  createdAt: string;
}

export interface MatchHubPlayerSnapshot {
  id: string;
  username: string;
  avatar?: string;
  elo: number;
  region: string;
  seed: number;
  record: string;
  stats: Array<{ label: string; value: string }>;
}

export interface MatchHubDetails {
  id: string;
  tournamentId: string;
  tournamentName: string;
  gameType: string;
  bracketFormat: "single_elimination" | "double_elimination";
  roundLabel: string;
  arenaLabel: string;
  status: BracketMatch["status"];
  bestOf: number;
  scheduledTime: string;
  startedAt?: string;
  streamTitle?: string;
  prizePool: number;
  player1: MatchHubPlayerSnapshot;
  player2: MatchHubPlayerSnapshot;
  scorePlayer1: number;
  scorePlayer2: number;
  winnerId?: string;
  notes: string;
  reports: ScoreReport[];
  feed: MatchHubEvent[];
  canDisputeUntil: string;
}