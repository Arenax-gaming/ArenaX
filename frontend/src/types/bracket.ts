export interface PlayerPerformanceStat {
  label: string;
  value: string;
}

export interface BracketPlayer {
  id: string;
  username: string;
  avatar?: string;
  elo: number;
  isCurrentUser?: boolean;
  seed?: number;
  region?: string;
  record?: string;
  stats?: PlayerPerformanceStat[];
}

export type BracketMatchStatus =
  | "pending"
  | "ready"
  | "in_progress"
  | "completed"
  | "disputed";

export interface ScoreReport {
  reporterId: string;
  reporterName: string;
  player1Score: number;
  player2Score: number;
  submittedAt: string;
}

export interface PrizeDistribution {
  position: number;
  percentage: number;
  amount?: number;
  label?: string;
  highlight?: string;
}

export interface BracketMatch {
  id: string;
  round: number;
  matchNumber: number;
  label?: string;
  roundLabel?: string;
  bestOf?: number;
  player1: BracketPlayer | null;
  player2: BracketPlayer | null;
  winnerId?: string;
  status: BracketMatchStatus;
  scorePlayer1?: number;
  scorePlayer2?: number;
  prizePool?: number;
  nextMatchId?: string;
  previousMatchIds?: string[];
  scheduledTime?: string;
  streamTitle?: string;
  venue?: string;
  notes?: string;
  isBye?: boolean;
  reports?: ScoreReport[];
  conflictReason?: string;
}

export interface BracketRound {
  roundNumber: number;
  roundName: string;
  shortLabel?: string;
  matches: BracketMatch[];
}

export type BracketSectionType = "winners" | "losers" | "finals";
export type BracketFormat = "single_elimination" | "double_elimination";

export interface BracketSection {
  id: string;
  title: string;
  type: BracketSectionType;
  rounds: BracketRound[];
}

export interface BracketData {
  tournamentId: string;
  tournamentName: string;
  format: BracketFormat;
  sections: BracketSection[];
  rounds?: BracketRound[];
  totalRounds: number;
  prizeDistribution: PrizeDistribution[];
  activeMatchIds?: string[];
  currentUserId?: string;
}

export function calculatePrizeDistribution(
  totalPrizePool: number,
): PrizeDistribution[] {
  return [
    {
      position: 1,
      percentage: 50,
      amount: totalPrizePool * 0.5,
      label: "Champion",
      highlight: "text-amber-300",
    },
    {
      position: 2,
      percentage: 25,
      amount: totalPrizePool * 0.25,
      label: "Runner-up",
      highlight: "text-slate-300",
    },
    {
      position: 3,
      percentage: 15,
      amount: totalPrizePool * 0.15,
      label: "Lower Finalist",
      highlight: "text-orange-300",
    },
    {
      position: 4,
      percentage: 10,
      amount: totalPrizePool * 0.1,
      label: "Top 4",
      highlight: "text-cyan-300",
    },
  ];
}
