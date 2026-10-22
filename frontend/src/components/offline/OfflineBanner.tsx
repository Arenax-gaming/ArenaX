'use client';

/**
 * Issue #1411 — Offline indicator banner with last-sync timestamp.
 *
 * Behaviour:
 * - Appears at the top of the app when navigator.onLine is false.
 * - Shows how long ago the last successful API sync occurred.
 * - Switches to a "syncing" state when back online and mutations are replaying.
 * - Dismisses automatically 2 s after full connectivity is restored.
 * - Queued mutations are replayed by the OfflineContext sync queue (service-
 *   worker-agnostic); the service worker can also intercept background sync.
 */

import { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useOffline } from '@/contexts/OfflineContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

export function OfflineBanner() {
  const { isOnline: ctxOnline, isSyncing, pendingCount } = useOffline();
  const { timeSinceSync } = useOnlineStatus();

  // Derive visible state: show while offline or while re-syncing
  const shouldShow = !ctxOnline || isSyncing;
  const [visible, setVisible] = useState(shouldShow);

  useEffect(() => {
    if (shouldShow) {
      setVisible(true);
    } else {
      // Small delay so users notice the "back online" flash before it hides
      const t = setTimeout(() => setVisible(false), 2_000);
      return () => clearTimeout(t);
    }
  }, [shouldShow]);

  if (!visible) return null;

  const isBackOnline = ctxOnline && isSyncing;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={ctxOnline ? 'Back online, syncing changes' : 'You are offline'}
      data-testid="offline-banner"
      className={[
        'w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors duration-300',
        isBackOnline
          ? 'bg-blue-600 text-white'
          : 'bg-yellow-600 text-white',
      ].join(' ')}
    >
      {isBackOnline ? (
        <>
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>
            Back online — syncing
            {pendingCount > 0 ? ` (${pendingCount} remaining)` : ''}…
          </span>
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          <span>
            You&apos;re offline
            {timeSinceSync ? ` · Last synced ${timeSinceSync}` : ''}
            {pendingCount > 0
              ? ` · ${pendingCount} change${pendingCount !== 1 ? 's' : ''} pending`
              : ''}
          </span>
        </>
      )}
    </div>
  );
}

export default OfflineBanner;
