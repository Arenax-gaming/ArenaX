"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Search,
  UserPlus,
  Star,
  MoreVertical,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { VirtualList, VirtualListRenderProps } from "@/components/ui/VirtualList";
import { AvatarWithStatus, OnlineStatus } from "./OnlineStatus";
import type { Friend, UserStatus } from "@/types/social";

// Number of friends below which we skip virtualisation
const VIRTUALIZATION_THRESHOLD = 30;
const FRIEND_ROW_HEIGHT = 56; // px
const COMPACT_ROW_HEIGHT = 44; // px
const LIST_HEIGHT = 480; // px — default virtual scroll container height

interface FriendsListProps {
  friends: Friend[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRemoveFriend: (friendId: string) => void;
  onSendMessage: (friendId: string) => void;
  onInviteToParty: (friendId: string) => void;
  compact?: boolean;
  showActions?: boolean;
  /** Called when the user scrolls near the bottom */
  onLoadMore?: () => void;
  /** Show spinner at bottom while loading more */
  isLoadingMore?: boolean;
}

const statusOrder: Record<UserStatus, number> = {
  online: 0,
  "in-game": 1,
  away: 2,
  busy: 3,
  offline: 4,
};

// ─── Section header row (pinned above each group) ─────────────────────────────

type ListRow =
  | { kind: "header"; label: string }
  | { kind: "friend"; friend: Friend };

// ─── Stable row renderer ──────────────────────────────────────────────────────

interface RowRendererProps {
  row: ListRow;
  style: React.CSSProperties;
  compact: boolean;
  showActions: boolean;
  activeMenu: string | null;
  setActiveMenu: (id: string | null) => void;
  onRemoveFriend: (id: string) => void;
  onSendMessage: (id: string) => void;
  onInviteToParty: (id: string) => void;
}

function FriendRowRenderer({
  row,
  style,
  compact,
  showActions,
  activeMenu,
  setActiveMenu,
  onRemoveFriend,
  onSendMessage,
  onInviteToParty,
}: RowRendererProps) {
  if (row.kind === "header") {
    return (
      <div
        style={style}
        className="px-4 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center"
        role="rowheader"
      >
        {row.label}
      </div>
    );
  }

  const { friend } = row;
  return (
    <div
      style={style}
      className={`flex items-center gap-3 px-4 hover:bg-muted/40 transition-colors group ${compact ? "" : "py-0.5"}`}
      role="listitem"
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
            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500 shrink-0" aria-label="Favorite" />
          )}
        </div>
        {!compact && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {friend.status === "in-game" ? "🎮 In Game" : friend.currentActivity ?? ""}
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
        {showActions && !compact && (
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setActiveMenu(activeMenu === friend.id ? null : friend.id)}
              aria-label={`Options for ${friend.username}`}
              aria-expanded={activeMenu === friend.id}
            >
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            </Button>
            {activeMenu === friend.id && (
              <div
                className="absolute right-0 top-full mt-1 bg-card border rounded-md shadow-lg z-10 min-w-[160px]"
                role="menu"
              >
                <button
                  role="menuitem"
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                  onClick={() => { onSendMessage(friend.id); setActiveMenu(null); }}
                >
                  <MessageSquare className="h-4 w-4" aria-hidden="true" />
                  Send Message
                </button>
                <button
                  role="menuitem"
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2"
                  onClick={() => { onInviteToParty(friend.id); setActiveMenu(null); }}
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Invite to Party
                </button>
                <button
                  role="menuitem"
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-yellow-600"
                  onClick={() => setActiveMenu(null)}
                >
                  <Star className="h-4 w-4" aria-hidden="true" />
                  {friend.isFavorite ? "Unfavorite" : "Favorite"}
                </button>
                <div className="border-t my-1" role="separator" />
                <button
                  role="menuitem"
                  className="w-full px-3 py-2 text-sm text-left hover:bg-muted flex items-center gap-2 text-destructive"
                  onClick={() => { onRemoveFriend(friend.id); setActiveMenu(null); }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove Friend
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FriendsList({
  friends,
  searchQuery,
  onSearchChange,
  onRemoveFriend,
  onSendMessage,
  onInviteToParty,
  compact = false,
  showActions = true,
  onLoadMore,
  isLoadingMore = false,
}: FriendsListProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const sorted = useMemo(() => {
    return [...friends].sort((a, b) => {
      const sd = statusOrder[a.status] - statusOrder[b.status];
      if (sd !== 0) return sd;
      if (a.isFavorite && !b.isFavorite) return -1;
      if (!a.isFavorite && b.isFavorite) return 1;
      return 0;
    });
  }, [friends]);

  const filtered = useMemo(() => {
    return sorted.filter((f) =>
      f.username.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [sorted, searchQuery]);

  const onlineCount = friends.filter((f) => f.status !== "offline").length;

  // Build flat row array (headers + friend rows) for the virtual list
  const rows = useMemo((): ListRow[] => {
    if (compact) {
      return sorted.slice(0, 5).map((friend) => ({ kind: "friend", friend }));
    }
    const online = filtered.filter((f) => f.status !== "offline");
    const offline = filtered.filter((f) => f.status === "offline");
    const result: ListRow[] = [];
    if (online.length > 0) {
      result.push({ kind: "header", label: `Online — ${online.length}` });
      online.forEach((friend) => result.push({ kind: "friend", friend }));
    }
    if (offline.length > 0) {
      result.push({ kind: "header", label: `Offline — ${offline.length}` });
      offline.forEach((friend) => result.push({ kind: "friend", friend }));
    }
    return result;
  }, [compact, sorted, filtered]);

  const rowHeight = compact ? COMPACT_ROW_HEIGHT : FRIEND_ROW_HEIGHT;
  const useVirtual = !compact && friends.length >= VIRTUALIZATION_THRESHOLD;

  const renderRow = useCallback(
    ({ item, style }: VirtualListRenderProps<ListRow>) => (
      <FriendRowRenderer
        row={item}
        style={style}
        compact={compact}
        showActions={showActions}
        activeMenu={activeMenu}
        setActiveMenu={setActiveMenu}
        onRemoveFriend={onRemoveFriend}
        onSendMessage={onSendMessage}
        onInviteToParty={onInviteToParty}
      />
    ),
    [compact, showActions, activeMenu, onRemoveFriend, onSendMessage, onInviteToParty]
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
            <Button variant="ghost" size="sm" className="h-7 px-2" aria-label="Add friend">
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y" role="list" aria-label="Friends">
            {rows.map((row, i) =>
              row.kind === "friend" ? (
                <FriendRowRenderer
                  key={row.friend.id}
                  row={row}
                  style={{}}
                  compact
                  showActions={false}
                  activeMenu={null}
                  setActiveMenu={() => {}}
                  onRemoveFriend={onRemoveFriend}
                  onSendMessage={onSendMessage}
                  onInviteToParty={onInviteToParty}
                />
              ) : null
            )}
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
            <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
            Add Friend
          </Button>
        </div>
      </CardHeader>

      <div className="px-6 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search friends..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Search friends"
          />
        </div>
      </div>

      <CardContent className="p-0 flex-1 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <UserPlus className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No friends found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {searchQuery
                ? "Try searching with a different name"
                : "Start building your friend list!"}
            </p>
            <Button variant="primary">
              <UserPlus className="h-4 w-4 mr-2" aria-hidden="true" />
              Find Friends
            </Button>
          </div>
        ) : useVirtual ? (
          <VirtualList
            listId="friends-list"
            items={rows}
            itemHeight={rowHeight}
            height={LIST_HEIGHT}
            overscanCount={8}
            renderItem={renderRow}
            onLoadMore={onLoadMore}
            loadingIndicator={
              isLoadingMore ? (
                <div className="flex justify-center py-3" aria-busy="true">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : null
            }
          />
        ) : (
          // Static render for smaller lists
          <div className="divide-y" role="list" aria-label="Friends">
            {rows.map((row, i) => (
              <FriendRowRenderer
                key={row.kind === "friend" ? row.friend.id : `header-${i}`}
                row={row}
                style={{}}
                compact={false}
                showActions={showActions}
                activeMenu={activeMenu}
                setActiveMenu={setActiveMenu}
                onRemoveFriend={onRemoveFriend}
                onSendMessage={onSendMessage}
                onInviteToParty={onInviteToParty}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
