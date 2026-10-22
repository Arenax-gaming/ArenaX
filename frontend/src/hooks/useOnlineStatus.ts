'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface OnlineStatus {
  isOnline: boolean;
  lastSyncAt: Date | null;
  timeSinceSync: string | null;
}

/**
 * Issue #1411 — tracks navigator.onLine and the timestamp of the last
 * successful API response.
 *
 * Usage:
 *   const { isOnline, timeSinceSync, markSynced } = useOnlineStatus();
 *
 * Call `markSynced()` after every successful API response to keep the
 * "last synced X minutes ago" string up to date.
 */
export function useOnlineStatus(): OnlineStatus & { markSynced: () => void } {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  // Re-render every 30 s so the relative "X minutes ago" label stays fresh.
  const [, forceUpdate] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    tickRef.current = setInterval(() => forceUpdate((n) => n + 1), 30_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  /** Call this after each successful API response to record the sync time. */
  const markSynced = useCallback(() => {
    setLastSyncAt(new Date());
  }, []);

  const timeSinceSync = lastSyncAt ? formatTimeSince(lastSyncAt) : null;

  return { isOnline, lastSyncAt, timeSinceSync, markSynced };
}

function formatTimeSince(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1_000);
  if (diffSecs < 60) return 'just now';
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}
