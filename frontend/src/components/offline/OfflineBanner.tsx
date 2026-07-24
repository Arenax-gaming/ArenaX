"use client";

import { useOffline } from "@/contexts/OfflineContext";

export function OfflineBanner() {
  const { isOnline, isSyncing, pendingCount } = useOffline();

  if (isOnline && !isSyncing) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white transition-colors ${
        isSyncing ? "bg-blue-600" : "bg-yellow-600"
      }`}
    >
      {isSyncing ? (
        <>
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
          Syncing changes{pendingCount > 0 ? ` (${pendingCount} left)` : ""}…
        </>
      ) : (
        <>
          <span aria-hidden="true">⚡</span>
          You are offline
          {pendingCount > 0 && ` · ${pendingCount} change${pendingCount > 1 ? "s" : ""} pending`}
        </>
      )}
    </div>
  );
}
