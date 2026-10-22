'use client';

/**
 * Issue #1410 — In-app notification centre.
 *
 * Features:
 * - Bell icon with unread badge (capped at 99+)
 * - Dropdown listing recent notifications
 * - Per-notification mark-read button
 * - "Mark all read" clears the badge
 * - Cursor-based "Load more" pagination
 * - New WebSocket notifications prepend at the top (via prependNotification)
 * - Fully keyboard-navigable and screen-reader-friendly
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Bell, Check, CheckCheck, Loader2, ChevronDown } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import {
  useNotifications,
  AppNotification,
} from '@/hooks/useNotifications';

// ─── Emoji icon per notification type ────────────────────────────────────────

const TYPE_ICONS: Record<AppNotification['type'], string> = {
  match: '⚔️',
  tournament: '🏆',
  wallet: '💰',
  system: '🔔',
  achievement: '🎖️',
};

// ─── Individual notification row ──────────────────────────────────────────────

function NotificationItem({
  notification: n,
  onMarkRead,
}: {
  notification: AppNotification;
  onMarkRead: (id: string) => void;
}) {
  const timeAgo = formatDistanceToNow(new Date(n.createdAt), {
    addSuffix: true,
  });

  return (
    <li
      className={[
        'flex items-start gap-3 px-4 py-3 text-sm transition-colors',
        n.read ? 'opacity-60' : 'bg-accent/5',
      ].join(' ')}
    >
      {/* Type icon */}
      <span className="mt-0.5 text-base select-none" aria-hidden="true">
        {TYPE_ICONS[n.type]}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-card-foreground leading-snug">
          {n.title}
        </p>
        <p className="truncate text-muted-foreground mt-0.5">{n.body}</p>
        <p className="mt-1 text-xs text-muted-foreground">{timeAgo}</p>
      </div>

      {/* Mark-read button */}
      {!n.read && (
        <button
          onClick={() => onMarkRead(n.id)}
          aria-label={`Mark "${n.title}" as read`}
          className="mt-0.5 flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface NotificationCentreProps {
  className?: string;
}

export function NotificationCentre({ className }: NotificationCentreProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    badgeLabel,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    markRead,
    markAllRead,
  } = useNotifications();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleLoadMore = useCallback(() => {
    fetchNextPage();
  }, [fetchNextPage]);

  return (
    <div
      ref={containerRef}
      className={['relative', className].filter(Boolean).join(' ')}
      data-testid="notification-centre"
    >
      {/* ── Bell button ── */}
      <button
        aria-label={
          unreadCount > 0
            ? `Notifications, ${badgeLabel} unread`
            : 'Notifications'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground"
          >
            {badgeLabel}
          </span>
        )}
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label="Notifications"
          className="absolute right-0 top-12 z-50 w-80 rounded-xl border border-border bg-card shadow-xl sm:w-96 animate-in fade-in-0 zoom-in-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-card-foreground">
              Notifications
            </h2>

            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                aria-label="Mark all notifications as read"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <ul
            role="list"
            aria-label="Notification list"
            className="max-h-96 overflow-y-auto divide-y divide-border"
          >
            {isLoading ? (
              <li className="flex items-center justify-center py-10">
                <Loader2
                  className="h-5 w-5 animate-spin text-muted-foreground"
                  aria-label="Loading notifications"
                />
              </li>
            ) : notifications.length === 0 ? (
              <li className="py-10 text-center text-sm text-muted-foreground">
                No notifications yet
              </li>
            ) : (
              notifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={markRead}
                />
              ))
            )}
          </ul>

          {/* Load more */}
          {hasNextPage && (
            <div className="border-t border-border p-2">
              <button
                onClick={handleLoadMore}
                disabled={isFetchingNextPage}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Load more notifications"
              >
                {isFetchingNextPage ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Load more
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationCentre;
