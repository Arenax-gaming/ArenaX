'use client';

import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getProfileById } from '@/data/user';
import { isSectionVisible } from '@/lib/profile-utils';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { StatsOverview } from '@/components/profile/StatsOverview';
import { MatchHistory } from '@/components/profile/MatchHistory';
import { AchievementShowcase } from '@/components/profile/AchievementShowcase';
import { FriendsList } from '@/components/profile/FriendsList';
import { ActivityFeed } from '@/components/profile/ActivityFeed';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getProfileById(id);
  if (!data) return { title: 'Profile Not Found' };
  return {
    title: `${data.profile.username}'s Profile`,
    description: data.profile.bio ?? `View ${data.profile.username}'s gaming profile`,
    openGraph: {
      title: `${data.profile.username}'s Profile`,
      description: data.profile.bio ?? '',
      images: data.profile.avatar ? [{ url: data.profile.avatar }] : [],
    },
  };
}

export default function ProfilePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const { user } = useAuth();

  const data = getProfileById(id);

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <p className="text-xl text-muted-foreground">Profile not found</p>
      </div>
    );
  }

  const { profile, stats, achievements, friends, activities, eloHistory } = data;

  const viewerRelation: 'owner' | 'friend' | 'public' =
    user?.id === profile.id ? 'owner' : 'public';

  const { privacySettings } = profile;

  function handleShareProfile() {
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        alert('Link copied!');
      });
    } else {
      prompt('Copy this link:', url);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Profile Header — always visible */}
      <div className="mb-6">
        <ProfileHeader
          user={profile}
          isOwner={viewerRelation === 'owner'}
          friendshipStatus="none"
        />
      </div>

      {/* Share button */}
      <div className="mb-6 flex justify-end">
        <button
          onClick={handleShareProfile}
          className="px-4 py-2 text-sm font-medium rounded-md border hover:bg-muted transition-colors"
        >
          Share Profile
        </button>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left / main column */}
        <div className="lg:col-span-2 space-y-6">
          {isSectionVisible(privacySettings.stats, viewerRelation) && (
            <StatsOverview stats={stats} eloHistory={eloHistory} />
          )}

          {isSectionVisible(privacySettings.matchHistory, viewerRelation) && (
            <MatchHistory matches={[]} currentUserId={profile.id} />
          )}

          {isSectionVisible(privacySettings.achievements, viewerRelation) && (
            <AchievementShowcase achievements={achievements} />
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {isSectionVisible(privacySettings.friends, viewerRelation) && (
            <FriendsList
              friends={friends}
              isOwner={viewerRelation === 'owner'}
            />
          )}

          {isSectionVisible(privacySettings.activityFeed, viewerRelation) && (
            <ActivityFeed activities={activities} />
          )}
        </div>
      </div>
    </div>
  );
}
