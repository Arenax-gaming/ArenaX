"use client";

import { useState, useMemo } from "react";
import { Search, UserPlus, Star, MoreVertical, MessageSquare, UserX, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AvatarWithStatus, OnlineStatus } from "./OnlineStatus";
import type { Friend, UserStatus } from "@/types/social";

interface FriendsListProps {
  friends: Friend[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRemoveFriend: (friendId: string) => void;
  onSendMessage: (friendId: string) => void;
  onInviteToParty: (friendId: string) => void;
  compact?: boolean;
  showActions?: boolean;
}

const statusOrder: Record<UserStatus, number> = {
  online: 0,
  "in-game": 1,
  away: 2,
  busy: 3,
  offline: 4,
};

export function FriendsList({
  friends,
  searchQuery,
  onSearchChange,
  onRemoveFriend,
  onSendMessage,
  onInviteToParty,
  compact = false,
  showActions = true,
}: FriendsListProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const sortedFriends = useMemo(() => {
    return [...friends].sort((a, b) => {
      // First sort by online status
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      // Then by favorite status
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return 0;
    });
  }, [friends]);

  const filteredFriends = useMemo(() => {
    return sortedFriends.filter(f =>
      f.username.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [sortedFriends, searchQuery]);

  const groupedFriends = useMemo(() => {
    const online = filteredFriends.filter(f => f.status !== "offline");
    const offline = filteredFriends.filter(f => f.status === "offline");
    return { online, offline };
  }, [filteredFriends]);

  const onlineCount = friends.filter(f => f.status !== "offline").length;

  const FriendItem = ({ friend, showDetails = true }: { friend: Friend; showDetails?: boolean }) => (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group ${
        showDetails ? "" : "py-1.5"
      }`}
    >
      <AvatarWithStatus
        avatar={friend.avatar}
        username={friend.username}
        status={friend.status}
        size={compact ? "sm" : "md"}
        className="shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-medium truncate ${compact ? "text-sm" : "text-base"}`}>
            {friend.username}
          </span>
          {friend.isFavorite && (
            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
          )}
        </div>
        {showDetails && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {friend.status === "in-game" ? "🎮 In Game" : friend.currentActivity || ""}
            </span>
            {friend.mutualFriends !== undefined && friend.mutualFriends > 0 && (
              <span className="text-xs text-muted-foreground">
                · {friend.mutualFriends} mutual
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground hidden sm:inline">
          {friend.elo}
        </span>
        {showActions && (
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setActiveMenu(activeMenu === friend.id ? null : friend.id)}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
            {activeMenu === friend.id && (
              <div className="absolute right-0 top-full mt-1 bg-card border rounded-md shadow-lg z-10 min-w-[160px]">
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                  onClick={() => {
                    onSendMessage(friend.id);
                    setActiveMenu(null);
                  }}
                >
                  <MessageSquare className="h-4 w-4" />
                  Send Message
                </button>
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                  onClick={() => {
                    onInviteToParty(friend.id);
                    setActiveMenu(null);
                  }}
                >
                  <UserPlus className="h-4 w-4" />
                  Invite to Party
                </button>
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-yellow-600"
                  onClick={() => setActiveMenu(null)}
                >
                  <Star className="h-4 w-4" />
                  {friend.isFavorite ? "Unfavorite" : "Favorite"}
                </button>
                <div className="border-t my-1" />
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-red-600"
                  onClick={() => {
                    onRemoveFriend(friend.id);
                    setActiveMenu(null);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Remove Friend
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  if (compact) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">
              Friends{" "}
              <span className="text-muted-foreground font-normal text-sm">
                ({onlineCount} online)
              </span>
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 px-2">
              <UserPlus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {sortedFriends.slice(0, 5).map((friend) => (
              <FriendItem key={friend.id} friend={friend} showDetails={false} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-black">
            Friends{" "}
            <span className="text-muted-foreground font-normal text-lg">
              ({onlineCount} online)
            </span>
          </CardTitle>
          <Button variant="primary" size="sm" className="h-8">
            <UserPlus className="h-4 w-4 mr-2" />
            Add Friend
          </Button>
        </div>
      </CardHeader>
      <div className="px-6 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search friends..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <CardContent className="p-0 flex-1 overflow-auto">
        {filteredFriends.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <UserPlus className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No friends found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {searchQuery
                ? "Try searching with a different name"
                : "Start building your friend list!"}
            </p>
            <Button variant="primary">
              <UserPlus className="h-4 w-4 mr-2" />
              Find Friends
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {groupedFriends.online.length > 0 && (
              <>
                <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky top-0">
                  Online — {groupedFriends.online.length}
                </div>
                {groupedFriends.online.map((friend) => (
                  <FriendItem key={friend.id} friend={friend} />
                ))}
              </>
            )}
            {groupedFriends.offline.length > 0 && (
              <>
                <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky top-0">
                  Offline — {groupedFriends.offline.length}
                </div>
                {groupedFriends.offline.map((friend) => (
                  <FriendItem key={friend.id} friend={friend} />
                ))}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}