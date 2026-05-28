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
import { Button } from '@/components/ui/Button';
import { Share2, Settings, UserPlus, MessageCircle } from 'lucide-react';
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
    user?.id === profile.id ? 'owner' : 
    friends.some(f => f.id === user?.id) ? 'friend' : 'public';

  const { privacySettings } = profile;

  function handleShareProfile() {
    const url = window.location.href;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        // You could add a toast notification here
        alert('Profile link copied to clipboard!');
      });
    } else {
      prompt('Copy this link:', url);
    }
  }

  function handleAddFriend() {
    // Implement add friend functionality
    console.log('Add friend:', profile.id);
  }

  function handleRemoveFriend(friendId: string) {
    // Implement remove friend functionality
    console.log('Remove friend:', friendId);
  }

  function handleMessageFriend(friendId: string) {
    // Implement message friend functionality
    console.log('Message friend:', friendId);
  }

  function handleSendMessage() {
    // Implement send message functionality
    console.log('Send message to:', profile.id);
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Profile Header */}
      <div className="mb-6">
        <ProfileHeader
          user={profile}
          isOwner={viewerRelation === 'owner'}
          friendshipStatus={viewerRelation === 'friend' ? 'friends' : 'none'}
        />
      </div>

      {/* Action Bar */}
      <div className="mb-6 flex flex-wrap gap-3 justify-between items-center">
        <div className="flex flex-wrap gap-3">
          {viewerRelation === 'owner' && (
            <Button variant="outline" asChild>
              <a href="/profile/edit">
                <Settings className="h-4 w-4 mr-2" />
                Edit Profile
              </a>
            </Button>
          )}
          
          {viewerRelation === 'public' && (
            <Button onClick={handleAddFriend}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Friend
            </Button>
          )}
          
          {viewerRelation !== 'owner' && (
            <Button variant="outline" onClick={handleSendMessage}>
              <MessageCircle className="h-4 w-4 mr-2" />
              Send Message
            </Button>
          )}
        </div>

        <Button variant="outline" onClick={handleShareProfile}>
          <Share2 className="h-4 w-4 mr-2" />
          Share Profile
        </Button>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Main Content */}
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

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {isSectionVisible(privacySettings.friends, viewerRelation) && (
            <FriendsList 
              friends={friends} 
              isOwner={viewerRelation === 'owner'}
              onAddFriend={handleAddFriend}
              onRemoveFriend={handleRemoveFriend}
              onMessageFriend={handleMessageFriend}
            />
          )}
          
          {isSectionVisible(privacySettings.activityFeed, viewerRelation) && (
            <ActivityFeed activities={activities} />
          )}
        </div>
      </div>

      {/* Privacy Notice */}
      {viewerRelation !== 'owner' && (
        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            Some sections may be hidden based on {profile.username}&apos;s privacy settings.
          </p>
        </div>
      )}
    </div>
  );
}
