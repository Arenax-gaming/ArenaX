// Bracket-related types for tournament visualization

export interface BracketPlayer {
  id: string;
  username: string;
  avatar?: string;
  elo: number;
  isCurrentUser?: boolean;
}

export interface BracketMatch {
  id: string;
  round: number;
  matchNumber: number;
  player1: BracketPlayer | null;
  player2: BracketPlayer | null;
  winnerId?: string;
  status: BracketMatchStatus;
  scorePlayer1?: number;
  scorePlayer2?: number;
  prizePool?: number;
  nextMatchId?: string; // For progression
}

export type BracketMatchStatus = 
  | "pending" 
  | "in_progress" 
  | "completed" 
  | "disputed";

export interface BracketRound {
  roundNumber: number;
  roundName: string;
  matches: BracketMatch[];
}

export interface BracketData {
  tournamentId: string;
  tournamentName: string;
  rounds: BracketRound[];
  totalRounds: number;
  prizeDistribution: PrizeDistribution[];
}

export interface PrizeDistribution {
  position: number;
  percentage: number;
  amount?: number;
}

// Helper function to calculate prize pool distribution
export function calculatePrizeDistribution(totalPrizePool: number): PrizeDistribution[] {
  return [
    { position: 1, percentage: 50, amount: totalPrizePool * 0.5 },
    { position: 2, percentage: 25, amount: totalPrizePool * 0.25 },
    { position: 3, percentage: 12.5, amount: totalPrizePool * 0.125 },
    { position: 4, percentage: 12.5, amount: totalPrizePool * 0.125 },
  ];
}
