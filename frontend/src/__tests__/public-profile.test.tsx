import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock child components
jest.mock('@/components/profile/ProfileHeader', () => ({
  ProfileHeader: () => <div data-testid="profile-header" />,
}));
jest.mock('@/components/profile/StatsOverview', () => ({
  StatsOverview: () => <div data-testid="stats-overview" />,
}));
jest.mock('@/components/profile/MatchHistory', () => ({
  MatchHistory: () => <div data-testid="match-history" />,
}));
jest.mock('@/components/profile/AchievementShowcase', () => ({
  AchievementShowcase: () => <div data-testid="achievement-showcase" />,
}));
jest.mock('@/components/profile/FriendsList', () => ({
  FriendsList: () => <div data-testid="friends-list" />,
}));
jest.mock('@/components/profile/ActivityFeed', () => ({
  ActivityFeed: () => <div data-testid="activity-feed" />,
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// We need to mock getProfileById so we can control data per test
jest.mock('@/data/user', () => ({
  getProfileById: jest.fn(),
}));

import { getProfileById } from '@/data/user';
import ProfilePage from '@/app/profile/[id]/page';
import { generateMetadata } from '@/app/profile/[id]/page';
import type { PublicProfile, PlayerStats } from '@/types/profile';

const mockGetProfileById = getProfileById as jest.MockedFunction<typeof getProfileById>;

const baseProfile: PublicProfile = {
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
};

const baseStats: PlayerStats = {
  elo: 1250,
  globalRank: 42,
  wins: 67,
  losses: 33,
  winRate: 67.0,
  currentStreak: 3,
};

const baseData = {
  profile: baseProfile,
  stats: baseStats,
  achievements: [],
  friends: [],
  activities: [],
  eloHistory: [
    { date: '2026-01-01', elo: 1000 },
    { date: '2026-01-08', elo: 1250 },
  ],
};

describe('ProfilePage', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders 404 state for unknown profile id', () => {
    mockGetProfileById.mockReturnValue(null);
    render(<ProfilePage params={{ id: 'unknown-id' }} />);
    expect(screen.getByText(/profile not found/i)).toBeInTheDocument();
    expect(screen.queryByTestId('profile-header')).not.toBeInTheDocument();
  });

  it('renders profile header when profile exists', () => {
    mockGetProfileById.mockReturnValue(baseData);
    render(<ProfilePage params={{ id: 'user-123' }} />);
    expect(screen.getByTestId('profile-header')).toBeInTheDocument();
  });

  it('hides stats-overview when privacy setting is only_me and viewer is not owner', () => {
    mockGetProfileById.mockReturnValue({
      ...baseData,
      profile: {
        ...baseProfile,
        privacySettings: {
          ...baseProfile.privacySettings,
          stats: 'only_me',
        },
      },
    });
    // useAuth returns null user (not owner)
    render(<ProfilePage params={{ id: 'user-123' }} />);
    expect(screen.queryByTestId('stats-overview')).not.toBeInTheDocument();
  });

  it('shows stats-overview when privacy setting is everyone', () => {
    mockGetProfileById.mockReturnValue(baseData);
    render(<ProfilePage params={{ id: 'user-123' }} />);
    expect(screen.getByTestId('stats-overview')).toBeInTheDocument();
  });

  it('hides friends-list when privacy setting is only_me and viewer is not owner', () => {
    mockGetProfileById.mockReturnValue({
      ...baseData,
      profile: {
        ...baseProfile,
        privacySettings: {
          ...baseProfile.privacySettings,
          friends: 'only_me',
        },
      },
    });
    render(<ProfilePage params={{ id: 'user-123' }} />);
    expect(screen.queryByTestId('friends-list')).not.toBeInTheDocument();
  });
});

describe('generateMetadata', () => {
  it('returns Profile Not Found title for unknown id', async () => {
    mockGetProfileById.mockReturnValue(null);
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'unknown' }) });
    expect(meta.title).toBe('Profile Not Found');
  });

  it('returns correct title and description for known profile', async () => {
    mockGetProfileById.mockReturnValue(baseData);
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'user-123' }) });
    expect(meta.title).toBe("ProGamer99's Profile");
    expect((meta as { description?: string }).description).toBe('Competitive player.');
  });

  it('includes openGraph image when avatar is set', async () => {
    mockGetProfileById.mockReturnValue(baseData);
    const meta = await generateMetadata({ params: Promise.resolve({ id: 'user-123' }) }) as {
      openGraph?: { images?: { url: string }[] };
    };
    expect(meta.openGraph?.images?.[0]?.url).toBe(
      'https://api.dicebear.com/7.x/avataaars/svg?seed=ProGamer99'
    );
  });
});
