/**
 * Advanced player analytics types (Issue #1266).
 *
 * Shapes returned by `GET /api/v1/analytics/player/{playerId}` and consumed by
 * `PlayerAnalyticsDashboard` to render win/loss trends, Elo progression, match
 * history, per-game / per-tournament breakdowns and peer comparison.
 */

export type MatchOutcome = "win" | "loss" | "draw";

export interface PlayerAnalyticsSummary {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  currentElo: number;
  peakElo: number;
  currentStreak: number;
  /** Longest win streak on record. */
  bestStreak: number;
}

export interface WinLossPoint {
  /** ISO date (bucketed by day or week). */
  date: string;
  wins: number;
  losses: number;
}

export interface EloProgressionPoint {
  date: string;
  elo: number;
}

export interface MatchHistoryEntry {
  id: string;
  game: string;
  mode: string;
  opponent: string;
  result: MatchOutcome;
  /** Player's score in the match. */
  score: number;
  /** Opponent's score. */
  opponentScore: number;
  eloDelta: number;
  /** Present when the match belonged to a tournament. */
  tournamentId?: string;
  tournamentName?: string;
  playedAt: string;
}

export interface GameBreakdown {
  game: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  avgEloDelta: number;
}

export interface TournamentBreakdown {
  id: string;
  name: string;
  matches: number;
  wins: number;
  /** Final placement, 1 = champion. */
  placement: number;
  prize?: number;
}

export interface PeerComparisonMetric {
  metric: string;
  /** The player's value. */
  player: number;
  /** Cohort average for the same metric. */
  peerAverage: number;
  /** Percentile rank in the cohort (0–100). */
  percentile: number;
}

export interface PlayerAnalytics {
  playerId: string;
  summary: PlayerAnalyticsSummary;
  winLossTrend: WinLossPoint[];
  eloProgression: EloProgressionPoint[];
  matchHistory: MatchHistoryEntry[];
  gameBreakdown: GameBreakdown[];
  tournamentBreakdown: TournamentBreakdown[];
  peerComparison: PeerComparisonMetric[];
  /** Cohort the peer comparison is measured against (e.g. "Gold III"). */
  peerCohort: string;
}

export interface MatchHistoryFilter {
  game?: string;
  result?: MatchOutcome | "all";
  tournamentId?: string;
  from?: string;
  to?: string;
}

/** A sane, renderable default so the dashboard is never blank. */
export const EMPTY_PLAYER_ANALYTICS: PlayerAnalytics = {
  playerId: "",
  summary: {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    currentElo: 0,
    peakElo: 0,
    currentStreak: 0,
    bestStreak: 0,
  },
  winLossTrend: [],
  eloProgression: [],
  matchHistory: [],
  gameBreakdown: [],
  tournamentBreakdown: [],
  peerComparison: [],
  peerCohort: "Unranked",
};
