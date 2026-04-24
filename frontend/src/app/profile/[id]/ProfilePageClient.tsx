'use client';

import React from 'react';
import { useAuth } from '@/hooks/useAuth';
import { isSectionVisible } from '@/lib/profile-utils';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { StatsOverview } from '@/components/profile/StatsOverview';
import { MatchHistory } from '@/components/profile/MatchHistory';
import { AchievementShowcase } from '@/components/profile/AchievementShowcase';
import { FriendsList } from '@/components/profile/FriendsList';
import { ActivityFeed } from '@/components/profile/ActivityFeed';
import type { PublicProfile, PlayerStats, Achievement, FriendEntry, ActivityEvent } from '@/types/profile';
import type { EloPoint } from '@/types/user';

interface ProfilePageClientProps {
  profile: PublicProfile;
  stats: PlayerStats;
  achievements: Achievement[];
  friends: FriendEntry[];
  activities: ActivityEvent[];
  eloHistory: EloPoint[];
}

export function ProfilePageClient({
  profile,
  stats,
  achievements,
  friends,
  activities,
  eloHistory,
}: ProfilePageClientProps) {
  const { user } = useAuth();

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
      <div className="mb-6">
        <ProfileHeader
          user={profile}
          isOwner={viewerRelation === 'owner'}
          friendshipStatus="none"
        />
      </div>

      <div className="mb-6 flex justify-end">
        <button
          onClick={handleShareProfile}
          className="px-4 py-2 text-sm font-medium rounded-md border hover:bg-muted transition-colors"
        >
          Share Profile
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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

        <div className="space-y-6">
          {isSectionVisible(privacySettings.friends, viewerRelation) && (
            <FriendsList friends={friends} isOwner={viewerRelation === 'owner'} />
          )}
          {isSectionVisible(privacySettings.activityFeed, viewerRelation) && (
            <ActivityFeed activities={activities} />
          )}
        </div>
      </div>
    </div>
  );
}
