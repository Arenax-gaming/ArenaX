'use client';

import { useState, useRef, useEffect } from 'react';
import { PresenceUser } from '@/types/collaboration';
import { cn } from '@/lib/utils';

interface PresenceIndicatorProps {
  users: PresenceUser[];
  currentUserId?: string;
  maxVisible?: number;
  onUserClick?: (userId: string) => void;
  className?: string;
}

const statusColors: Record<string, string> = {
  online: 'bg-green-500',
  away: 'bg-yellow-500',
  busy: 'bg-red-500',
  offline: 'bg-gray-400',
};

const statusLabels: Record<string, string> = {
  online: 'Online',
  away: 'Away',
  busy: 'Busy',
  offline: 'Offline',
};

function PresenceAvatar({ user, onClick }: { user: PresenceUser; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative flex-shrink-0 group"
      title={`${user.username} — ${statusLabels[user.status]}`}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
        style={{ backgroundColor: user.color }}
      >
        {user.username.charAt(0).toUpperCase()}
      </div>
      <span
        className={cn(
          'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background',
          statusColors[user.status]
        )}
      />
      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-2 py-1 bg-foreground text-background text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        <div className="font-medium">{user.username}</div>
        <div className="text-muted-foreground">{statusLabels[user.status]}</div>
      </div>
    </button>
  );
}

export function PresenceIndicator({
  users,
  currentUserId,
  maxVisible = 5,
  onUserClick,
  className,
}: PresenceIndicatorProps) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...users].sort((a, b) => {
    const statusOrder = { online: 0, away: 1, busy: 2, offline: 3 };
    return (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
  });

  const visible = showAll ? sorted : sorted.slice(0, maxVisible);
  const overflow = sorted.length - maxVisible;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <div className="flex items-center -space-x-1">
        {visible.map(user => (
          <PresenceAvatar
            key={user.userId}
            user={user}
            onClick={() => onUserClick?.(user.userId)}
          />
        ))}
        {overflow > 0 && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground hover:bg-muted/80 border-2 border-background -ml-1"
            title={`${overflow} more users`}
          >
            +{overflow}
          </button>
        )}
      </div>
      {sorted.length > 0 && (
        <span className="text-xs text-muted-foreground ml-2">
          {sorted.filter(u => u.status === 'online').length} online
        </span>
      )}
    </div>
  );
}
