import React from 'react';
import { render, screen } from '@testing-library/react';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import type { PublicProfile } from '@/types/profile';

// Mock next/link to avoid router dependency in tests
jest.mock('next/link', () => {
  const MockLink = ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  );
  MockLink.displayName = 'MockLink';
  return MockLink;
});

// Mock next/image to avoid optimization pipeline in tests
jest.mock('next/image', () => {
  const MockImage = ({ src, alt, width, height, className }: { src: string; alt: string; width: number; height: number; className?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} width={width} height={height} className={className} />
  );
  MockImage.displayName = 'MockImage';
  return MockImage;
});

const baseUser: PublicProfile = {
  id: 'user-1',
  username: 'TestPlayer',
  elo: 1500,
  globalRank: 42,
  createdAt: '2023-01-15T00:00:00Z',
  isOnline: false,
  customization: { banner: 'default', colorTheme: 'blue' },
  privacySettings: {
    stats: 'everyone',
    matchHistory: 'everyone',
    achievements: 'everyone',
    friends: 'everyone',
    activityFeed: 'everyone',
  },
};

describe('ProfileHeader', () => {
  // Test: fallback avatar renders first char of username when no avatar URL
  it('shows first character of username as fallback when no avatar URL', () => {
    render(
      <ProfileHeader
        user={{ ...baseUser, avatar: undefined }}
        isOwner={false}
        friendshipStatus="none"
      />
    );
    // The fallback div should show the first character uppercased
    expect(screen.getByText('T')).toBeInTheDocument();
    // No img element should be present for the avatar
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows avatar image when avatar URL is provided', () => {
    render(
      <ProfileHeader
        user={{ ...baseUser, avatar: 'https://example.com/avatar.png' }}
        isOwner={false}
        friendshipStatus="none"
      />
    );
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  // Test: "Edit Profile" button appears for owner, not for non-owner
  it('shows "Edit Profile" button when isOwner is true', () => {
    render(
      <ProfileHeader user={baseUser} isOwner={true} friendshipStatus="none" />
    );
    expect(screen.getByRole('link', { name: /edit profile/i })).toBeInTheDocument();
  });

  it('does not show "Edit Profile" button when isOwner is false', () => {
    render(
      <ProfileHeader user={baseUser} isOwner={false} friendshipStatus="none" />
    );
    expect(screen.queryByRole('link', { name: /edit profile/i })).not.toBeInTheDocument();
  });

  it('shows "Add Friend" button when not owner and friendshipStatus is none', () => {
    render(
      <ProfileHeader user={baseUser} isOwner={false} friendshipStatus="none" />
    );
    expect(screen.getByRole('button', { name: /add friend/i })).toBeInTheDocument();
  });

  it('shows "Remove Friend" button when not owner and friendshipStatus is friends', () => {
    render(
      <ProfileHeader user={baseUser} isOwner={false} friendshipStatus="friends" />
    );
    expect(screen.getByRole('button', { name: /remove friend/i })).toBeInTheDocument();
  });

  // Test: online indicator is green when isOnline true, grey when false
  it('online indicator has green background when user is online', () => {
    render(
      <ProfileHeader user={{ ...baseUser, isOnline: true }} isOwner={false} friendshipStatus="none" />
    );
    const indicator = screen.getByTestId('online-indicator');
    expect(indicator).toHaveClass('bg-green-500');
    expect(indicator).not.toHaveClass('bg-gray-400');
  });

  it('online indicator has grey background when user is offline', () => {
    render(
      <ProfileHeader user={{ ...baseUser, isOnline: false }} isOwner={false} friendshipStatus="none" />
    );
    const indicator = screen.getByTestId('online-indicator');
    expect(indicator).toHaveClass('bg-gray-400');
    expect(indicator).not.toHaveClass('bg-green-500');
  });
});
