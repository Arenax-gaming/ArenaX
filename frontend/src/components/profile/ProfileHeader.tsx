import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { PublicProfile } from '../../types/profile';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';

interface ProfileHeaderProps {
  user: PublicProfile;
  isOwner: boolean;
  friendshipStatus: 'none' | 'pending' | 'friends';
  onAddFriend?: () => void;
  onRemoveFriend?: () => void;
}

export function ProfileHeader({
  user,
  isOwner,
  friendshipStatus,
  onAddFriend,
  onRemoveFriend,
}: ProfileHeaderProps) {
  const joinDate = new Date(user.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
          {/* Avatar with online indicator */}
          <div className="relative flex-shrink-0">
            {user.avatar ? (
              <Image
                src={user.avatar}
                alt={`${user.username}'s avatar`}
                width={80}
                height={80}
                className="rounded-full object-cover"
              />
            ) : (
              <div
                className="w-20 h-20 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold"
                aria-label={`${user.username}'s avatar`}
              >
                {user.username.charAt(0).toUpperCase()}
              </div>
            )}
            {/* Online indicator */}
            <span
              className={`absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-white ${
                user.isOnline ? 'bg-green-500' : 'bg-gray-400'
              }`}
              aria-label={user.isOnline ? 'Online' : 'Offline'}
              data-testid="online-indicator"
              data-online={user.isOnline}
            />
          </div>

          {/* User info */}
          <div className="flex-1 text-center sm:text-left">
            <h1 className="text-2xl font-bold">{user.username}</h1>
            <div className="mt-1 flex flex-wrap justify-center sm:justify-start gap-x-4 gap-y-1 text-sm text-gray-500">
              <span>Rank #{user.globalRank}</span>
              <span>{user.elo} ELO</span>
              <span>Joined {joinDate}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex-shrink-0">
            {isOwner ? (
              <Link href="/profile/edit">
                <Button variant="outline" size="sm">
                  Edit Profile
                </Button>
              </Link>
            ) : (
              <>
                {friendshipStatus === 'none' && (
                  <Button variant="primary" size="sm" onClick={onAddFriend}>
                    Add Friend
                  </Button>
                )}
                {friendshipStatus === 'friends' && (
                  <Button variant="outline" size="sm" onClick={onRemoveFriend}>
                    Remove Friend
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
