"use client";

import React, { useState } from "react";
import { FriendEntry } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Users, Search, UserPlus, MessageCircle, UserMinus, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface FriendsListProps {
  friends: FriendEntry[];
  isOwner: boolean;
  onAddFriend?: () => void;
  onRemoveFriend?: (friendId: string) => void;
  onMessageFriend?: (friendId: string) => void;
}

// Enhanced FriendEntry interface
interface EnhancedFriendEntry extends FriendEntry {
  lastSeen?: string;
  currentActivity?: string;
  mutualFriends?: number;
}

const STATUS_ORDER: Record<FriendEntry["status"], number> = {
  online: 0,
  "in-game": 1,
  offline: 2,
};

const STATUS_COLOR: Record<FriendEntry["status"], string> = {
  online: "bg-green-500",
  "in-game": "bg-yellow-400",
  offline: "bg-gray-400",
};

const STATUS_LABELS: Record<FriendEntry["status"], string> = {
  online: "Online",
  "in-game": "In Game",
  offline: "Offline",
};

function formatLastSeen(lastSeen: string): string {
  const now = new Date();
  const lastSeenDate = new Date(lastSeen);
  const diffMs = now.getTime() - lastSeenDate.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffHours < 1) return "Just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return lastSeenDate.toLocaleDateString();
}

export function FriendsList({ 
  friends, 
  isOwner, 
  onAddFriend, 
  onRemoveFriend, 
  onMessageFriend 
}: FriendsListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFriend, setSelectedFriend] = useState<string | null>(null);

  // Convert to enhanced format with defaults
  const enhancedFriends: EnhancedFriendEntry[] = friends.map(friend => ({
    ...friend,
    lastSeen: (friend as any).lastSeen || new Date().toISOString(),
    currentActivity: (friend as any).currentActivity,
    mutualFriends: (friend as any).mutualFriends || 0,
  }));

  // Filter and sort friends
  const filteredFriends = enhancedFriends
    .filter(friend => 
      friend.username.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  const onlineFriendsCount = enhancedFriends.filter(f => f.status === 'online' || f.status === 'in-game').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Friends
            <span className="text-sm font-normal text-muted-foreground">
              ({onlineFriendsCount} online)
            </span>
          </span>
          {isOwner && (
            <Button size="sm" variant="outline" onClick={onAddFriend}>
              <UserPlus className="h-4 w-4 mr-1" />
              Add Friend
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Search */}
        {enhancedFriends.length > 5 && (
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {filteredFriends.length === 0 && searchQuery ? (
          <div className="text-center text-muted-foreground py-4">
            No friends found matching &quot;{searchQuery}&quot;
          </div>
        ) : filteredFriends.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-muted-foreground">No friends yet</p>
            {isOwner && (
              <Button variant="outline" size="sm" onClick={onAddFriend}>
                <UserPlus className="h-4 w-4 mr-1" />
                Find Players
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredFriends.map((friend) => (
              <div
                key={friend.id}
                data-testid="friend-item"
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group"
              >
                {/* Avatar placeholder */}
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                    {friend.username.charAt(0).toUpperCase()}
                  </div>
                  <span
                    data-testid="status-indicator"
                    data-status={friend.status}
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                      STATUS_COLOR[friend.status]
                    )}
                    title={STATUS_LABELS[friend.status]}
                  />
                </div>

                {/* Friend Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{friend.username}</span>
                    <span className="text-xs text-muted-foreground">{friend.elo} ELO</span>
                  </div>
                  
                  {/* Status and Activity */}
                  <div className="text-xs text-muted-foreground">
                    {friend.status === 'online' && "Online"}
                    {friend.status === 'in-game' && (
                      <span className="text-yellow-600 dark:text-yellow-400">
                        {friend.currentActivity || "In Game"}
                      </span>
                    )}
                    {friend.status === 'offline' && `Last seen ${formatLastSeen(friend.lastSeen!)}`}
                  </div>

                  {/* Mutual Friends */}
                  {friend.mutualFriends! > 0 && (
                    <div className="text-xs text-muted-foreground">
                      {friend.mutualFriends} mutual friend{friend.mutualFriends !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {friend.status !== 'offline' && onMessageFriend && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onMessageFriend(friend.id)}
                      className="h-8 w-8 p-0"
                      title="Send message"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </Button>
                  )}
                  
                  {isOwner && (
                    <div className="relative">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedFriend(selectedFriend === friend.id ? null : friend.id)}
                        className="h-8 w-8 p-0"
                        title="More options"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                      
                      {selectedFriend === friend.id && (
                        <div className="absolute right-0 top-full mt-1 bg-background border rounded-md shadow-lg z-10 min-w-[120px]">
                          <button
                            onClick={() => {
                              onRemoveFriend?.(friend.id);
                              setSelectedFriend(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 text-red-600 dark:text-red-400"
                          >
                            <UserMinus className="h-4 w-4" />
                            Remove Friend
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Quick Stats */}
        {enhancedFriends.length > 0 && (
          <div className="mt-4 pt-4 border-t text-xs text-muted-foreground text-center">
            {enhancedFriends.length} total friend{enhancedFriends.length !== 1 ? 's' : ''} • {onlineFriendsCount} online
          </div>
        )}
      </CardContent>
    </Card>
  );
}
