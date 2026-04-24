export interface PublicProfile {
  id: string;
  username: string;
  avatar?: string;
  bio?: string;
  socialLinks?: { twitter?: string; discord?: string; twitch?: string };
  elo: number;
  globalRank: number;
  createdAt: string;
  isOnline: boolean;
  customization: ProfileCustomization;
  privacySettings: PrivacySettings;
}

export interface PlayerStats {
  elo: number;
  globalRank: number;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: number;
  total: number;
  unlocked: boolean;
  unlockedAt?: string;
}

export interface FriendEntry {
  id: string;
  username: string;
  avatar?: string;
  elo: number;
  status: 'online' | 'in-game' | 'offline';
}

export type ActivityEventType =
  | 'match_completed'
  | 'achievement_unlocked'
  | 'tournament_joined'
  | 'tournament_completed'
  | 'friend_added';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  payload: Record<string, string | number | boolean>;
}

export interface ProfileCustomization {
  banner: string;
  colorTheme: string;
}

export type PrivacySetting = 'everyone' | 'friends' | 'only_me';

export interface PrivacySettings {
  stats: PrivacySetting;
  matchHistory: PrivacySetting;
  achievements: PrivacySetting;
  friends: PrivacySetting;
  activityFeed: PrivacySetting;
}

export interface MatchWithPlayers {
  id: string;
  player1Id: string;
  player2Id: string;
  player1Username: string;
  player2Username: string;
  winnerId: string;
  gameType: string;
  score: string;
  date: string;
  tournamentName?: string;
}

export interface MatchHistoryFilters {
  gameType?: string;
  result?: 'win' | 'loss';
  opponentSearch?: string;
}
