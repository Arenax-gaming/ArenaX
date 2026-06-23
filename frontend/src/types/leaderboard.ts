/** Compact player row used on the legacy /leaderboard page mock table. */
export interface LeaderboardPlayer {
  rank: number;
  userId: string;
  username: string;
  points: number;
  wins: number;
  winRate: number;
  game: string;
}

export interface LeaderboardEntry {
    id: string
    userId: string
    username: string
    avatarUrl?: string
    ranking: number
    eloRating: number
    matchesPlayed: number
    wins: number
    losses: number
    winRate: number
    period: string
    updatedAt: string
}

export interface LeaderboardResponse {
    entries: LeaderboardEntry[]
    totalCount: number
    period: string
    category: string
}

export interface PlayerRankResponse {
    userId: string
    username: string
    avatarUrl?: string
    currentRank: number
    eloRating: number
    matchesPlayed: number
    wins: number
    losses: number
    winRate: number
    rankChange?: number | null
    updatedAt: string
}

export interface RankHistoryEntry {
    rank: number
    eloRating: number
    period: string
    timestamp: string
}

export interface RankHistory {
    userId: string
    username: string
    history: RankHistoryEntry[]
}

export interface SeasonalLeaderboard {
    seasonId: string
    seasonName: string
    startDate: string
    endDate: string
    entries: LeaderboardEntry[]
    totalParticipants: number
}

export interface LeaderboardStats {
    totalPlayers: number
    averageElo: number
    medianElo: number
    topPlayerElo: number
    lastUpdated: string
}

export type LeaderboardCategory = 'global' | 'tournaments' | 'casual' | 'ranked'
