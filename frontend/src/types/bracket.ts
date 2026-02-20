// Bracket-related types

export interface BracketMatch {
  id: string;
  round: number;
  matchNumber: number;
  player1: BracketPlayer | null;
  player2: BracketPlayer | null;
  winnerId?: string;
  scorePlayer1?: number;
  scorePlayer2?: number;
  status: BracketMatchStatus;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
}

export type BracketMatchStatus =
  | "pending"
  | "ready"
  | "in_progress"
  | "completed"
  | "disputed";

export interface BracketPlayer {
  id: string;
  username: string;
  avatar?: string;
  isSeed?: boolean;
  seedNumber?: number;
  isEliminated?: boolean;
}

export interface BracketRound {
  roundNumber: number;
  roundName: string;
  matches: BracketMatch[];
}

export interface BracketData {
  id: string;
  tournamentId: string;
  tournamentName: string;
  tournamentType: BracketType;
  rounds: BracketRound[];
  createdAt: string;
  updatedAt: string;
}

export type BracketType =
  | "single_elimination"
  | "double_elimination"
  | "round_robin"
  | "swiss";

// Prize distribution for a bracket
export interface PrizeDistribution {
  position: number;
  positionName: string;
  prizeAmount: number;
  prizePercentage: number;
}

// Match details for modal
export interface MatchDetails {
  match: BracketMatch;
  tournamentName: string;
  gameType: string;
  prizeDistribution?: PrizeDistribution[];
  roundName: string;
}
