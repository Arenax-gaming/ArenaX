import { User, EloPoint } from "@/types/user";
import type { PublicProfile, PlayerStats, Achievement, FriendEntry, ActivityEvent } from '@/types/profile';

export const mockEloHistory: EloPoint[] = [
  { date: "2026-01-01", elo: 1000 },
  { date: "2026-01-08", elo: 1050 },
  { date: "2026-01-15", elo: 1030 },
  { date: "2026-01-22", elo: 1100 },
  { date: "2026-01-29", elo: 1150 },
  { date: "2026-02-05", elo: 1120 },
  { date: "2026-02-12", elo: 1200 },
  { date: "2026-02-19", elo: 1250 },
];

export const currentUser: User = {
  id: "user-123",
  username: "ProGamer99",
  email: "pro@arenax.com",
  isVerified: true,
  avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ProGamer99",
  bio: "Competitive CS2 and Valorant player. Always looking for the next challenge. Founder of Team Zenith.",
  socialLinks: {
    twitter: "https://twitter.com/progamer99",
    discord: "ProGamer#0001",
    twitch: "https://twitch.tv/progamer99",
  },
  elo: 1250,
  createdAt: "2026-01-01T10:00:00Z",
};

export const MOCK_PROFILES: Record<string, {
  profile: PublicProfile;
  stats: PlayerStats;
  achievements: Achievement[];
  friends: FriendEntry[];
  activities: ActivityEvent[];
  eloHistory: EloPoint[];
}> = {
  'user-123': {
    profile: {
      id: 'user-123',
      username: 'ProGamer99',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProGamer99',
      bio: 'Competitive player.',
      elo: 1250,
      globalRank: 42,
      createdAt: '2026-01-01T10:00:00Z',
      isOnline: true,
      customization: { banner: 'default', colorTheme: 'blue' },
      privacySettings: {
        stats: 'everyone',
        matchHistory: 'everyone',
        achievements: 'everyone',
        friends: 'everyone',
        activityFeed: 'everyone',
      },
    },
    stats: {
      elo: 1250,
      globalRank: 42,
      wins: 67,
      losses: 33,
      winRate: 67.0,
      currentStreak: 3,
      tournamentWins: 5,
      reputationScore: 92,
    },
    achievements: [],
    friends: [
      {
        id: 'user-456',
        username: 'ShadowNinja',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ShadowNinja',
        elo: 1180,
        status: 'online',
        gamesPlayed: 100,
      },
      {
        id: 'user-789',
        username: 'CyberKnight',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CyberKnight',
        elo: 1320,
        status: 'in-game',
        gamesPlayed: 150,
      },
    ],
    activities: [],
    eloHistory: [
      { date: '2026-01-01', elo: 1000 },
      { date: '2026-01-08', elo: 1250 },
    ],
  },
  'user-456': {
    profile: {
      id: 'user-456',
      username: 'ShadowNinja',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ShadowNinja',
      bio: 'Stealth and strategy.',
      elo: 1180,
      globalRank: 88,
      createdAt: '2026-01-10T12:00:00Z',
      isOnline: true,
      customization: { banner: 'default', colorTheme: 'purple' },
      privacySettings: {
        stats: 'everyone',
        matchHistory: 'everyone',
        achievements: 'everyone',
        friends: 'everyone',
        activityFeed: 'everyone',
      },
    },
    stats: {
      elo: 1180,
      globalRank: 88,
      wins: 45,
      losses: 55,
      winRate: 45.0,
      currentStreak: 1,
      tournamentWins: 2,
      reputationScore: 98,
    },
    achievements: [],
    friends: [
      {
        id: 'user-123',
        username: 'ProGamer99',
        avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=ProGamer99',
        elo: 1250,
        status: 'online',
        gamesPlayed: 100,
      },
    ],
    activities: [],
    eloHistory: [
      { date: '2026-01-10', elo: 1100 },
      { date: '2026-01-20', elo: 1180 },
    ],
  },
  'user-789': {
    profile: {
      id: 'user-789',
      username: 'CyberKnight',
      avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=CyberKnight',
      bio: 'Defending the realm in every tournament.',
      elo: 1320,
      globalRank: 15,
      createdAt: '2025-11-05T08:00:00Z',
      isOnline: false,
      customization: { banner: 'default', colorTheme: 'gold' },
      privacySettings: {
        stats: 'everyone',
        matchHistory: 'everyone',
        achievements: 'everyone',
        friends: 'everyone',
        activityFeed: 'everyone',
      },
    },
    stats: {
      elo: 1320,
      globalRank: 15,
      wins: 90,
      losses: 60,
      winRate: 60.0,
      currentStreak: 4,
      tournamentWins: 8,
      reputationScore: 88,
    },
    achievements: [],
    friends: [],
    activities: [],
    eloHistory: [
      { date: '2025-11-05', elo: 1200 },
      { date: '2026-01-15', elo: 1320 },
    ],
  },
};

export function getProfileById(id: string) {
  return MOCK_PROFILES[id] ?? null;
}
