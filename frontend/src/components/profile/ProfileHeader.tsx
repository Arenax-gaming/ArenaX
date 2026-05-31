import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { PublicProfile } from '../../types/profile';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';
import { 
  Settings, 
  UserPlus, 
  UserMinus, 
  MessageCircle, 
  Share2, 
  Trophy, 
  Calendar,
  MapPin,
  ExternalLink,
  Twitter,
  Github,
  Twitch,
  Copy,
  Check
} from 'lucide-react';

interface ProfileHeaderProps {
  user: PublicProfile;
  isOwner: boolean;
  friendshipStatus: 'none' | 'pending' | 'friends';
  onAddFriend?: () => void;
  onRemoveFriend?: () => void;
  onMessage?: () => void;
}

export function ProfileHeader({
  user,
  isOwner,
  friendshipStatus,
  onAddFriend,
  onRemoveFriend,
  onMessage,
}: ProfileHeaderProps) {
  const [copied, setCopied] = useState(false);
  
  const joinDate = new Date(user.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });

  const handleShare = async () => {
    const url = `${window.location.origin}/profile/${user.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getRankColor = (rank: number) => {
    if (rank <= 10) return 'text-yellow-500';
    if (rank <= 100) return 'text-orange-500';
    if (rank <= 1000) return 'text-blue-500';
    return 'text-gray-500 dark:text-gray-400';
  };

  const getEloTier = (elo: number) => {
    if (elo >= 2400) return { tier: 'Grandmaster', color: 'text-purple-500' };
    if (elo >= 2200) return { tier: 'Master', color: 'text-red-500' };
    if (elo >= 2000) return { tier: 'Diamond', color: 'text-blue-500' };
    if (elo >= 1800) return { tier: 'Platinum', color: 'text-cyan-500' };
    if (elo >= 1600) return { tier: 'Gold', color: 'text-yellow-500' };
    if (elo >= 1400) return { tier: 'Silver', color: 'text-gray-400' };
    return { tier: 'Bronze', color: 'text-orange-600' };
  };

  const eloTier = getEloTier(user.elo);

  return (
    <div className="relative">
      {/* Banner Background */}
      <div 
        className="h-48 w-full rounded-t-lg bg-gradient-to-r from-blue-600 via-purple-600 to-blue-800 relative overflow-hidden"
        style={{
          backgroundImage: user.customization?.banner !== 'default' 
            ? `url(/banners/${user.customization.banner}.jpg)` 
            : undefined
        }}
      >
        <div className="absolute inset-0 bg-black/20" />
        
        {/* Action buttons overlay */}
        <div className="absolute top-4 right-4 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleShare}
            className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
          >
            {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          </Button>
          
          {isOwner && (
            <Link href="/profile/settings">
              <Button
                variant="outline"
                size="sm"
                className="bg-white/10 backdrop-blur-sm border-white/20 text-white hover:bg-white/20"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Profile Content */}
      <Card className="relative -mt-24 mx-4 mb-0 rounded-t-none">
        <CardContent className="pt-20 pb-6">
          {/* Avatar */}
          <div className="absolute -top-16 left-6">
            <div className="relative">
              {user.avatar ? (
                <Image
                  src={user.avatar}
                  alt={`${user.username}'s avatar`}
                  width={128}
                  height={128}
                  className="rounded-full object-cover border-4 border-white shadow-lg"
                />
              ) : (
                <div
                  className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-4xl font-bold border-4 border-white shadow-lg"
                  aria-label={`${user.username}'s avatar`}
                >
                  {user.username.charAt(0).toUpperCase()}
                </div>
              )}
              
              {/* Online indicator */}
              <span
                className={`absolute bottom-2 right-2 w-6 h-6 rounded-full border-4 border-white shadow-md ${
                  user.isOnline ? 'bg-green-500' : 'bg-gray-400'
                }`}
                aria-label={user.isOnline ? 'Online' : 'Offline'}
                data-testid="online-indicator"
                data-online={user.isOnline}
              />
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            {/* User Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
                <h1 className="text-3xl font-bold truncate">{user.username}</h1>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${eloTier.color} bg-current/10`}>
                    <Trophy className="h-3 w-3 mr-1" />
                    {eloTier.tier}
                  </span>
                  {user.isOnline && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium text-green-600 bg-green-100">
                      Online
                    </span>
                  )}
                </div>
              </div>

              {/* Stats Row */}
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground mb-4">
                <span className={`flex items-center gap-1 font-medium ${getRankColor(user.globalRank)}`}>
                  <Trophy className="h-4 w-4" />
                  Rank #{user.globalRank.toLocaleString()}
                </span>
                <span className="flex items-center gap-1 font-medium">
                  <span className="w-4 h-4 rounded bg-gradient-to-r from-yellow-400 to-orange-500 flex items-center justify-center text-xs">⚡</span>
                  {user.elo.toLocaleString()} ELO
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  Joined {joinDate}
                </span>
              </div>

              {/* Bio */}
              {user.bio && (
                <p className="text-sm text-muted-foreground mb-4 max-w-2xl leading-relaxed">
                  {user.bio}
                </p>
              )}

              {/* Social Links */}
              {user.socialLinks && Object.values(user.socialLinks).some(link => link) && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {user.socialLinks.twitter && (
                    <a
                      href={user.socialLinks.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
                    >
                      <Twitter className="h-3 w-3" />
                      Twitter
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {user.socialLinks.discord && (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                      <span className="w-3 h-3 bg-indigo-500 rounded-full" />
                      {user.socialLinks.discord}
                    </span>
                  )}
                  {user.socialLinks.twitch && (
                    <a
                      href={user.socialLinks.twitch}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors"
                    >
                      <Twitch className="h-3 w-3" />
                      Twitch
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {user.socialLinks.github && (
                    <a
                      href={user.socialLinks.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                    >
                      <Github className="h-3 w-3" />
                      GitHub
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-2 lg:flex-col">
              {isOwner ? (
                <>
                  <Link href="/profile/edit">
                    <Button variant="default" className="w-full sm:w-auto">
                      Edit Profile
                    </Button>
                  </Link>
                  <Link href="/profile/settings">
                    <Button variant="outline" className="w-full sm:w-auto">
                      <Settings className="h-4 w-4 mr-2" />
                      Settings
                    </Button>
                  </Link>
                </>
              ) : (
                <>
                  {friendshipStatus === 'none' && (
                    <Button onClick={onAddFriend} className="w-full sm:w-auto">
                      <UserPlus className="h-4 w-4 mr-2" />
                      Add Friend
                    </Button>
                  )}
                  {friendshipStatus === 'pending' && (
                    <Button variant="outline" disabled className="w-full sm:w-auto">
                      <UserPlus className="h-4 w-4 mr-2" />
                      Request Sent
                    </Button>
                  )}
                  {friendshipStatus === 'friends' && (
                    <>
                      <Button onClick={onMessage} className="w-full sm:w-auto">
                        <MessageCircle className="h-4 w-4 mr-2" />
                        Message
                      </Button>
                      <Button variant="outline" onClick={onRemoveFriend} className="w-full sm:w-auto">
                        <UserMinus className="h-4 w-4 mr-2" />
                        Remove Friend
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
