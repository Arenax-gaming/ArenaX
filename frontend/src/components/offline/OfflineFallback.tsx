"use client";

import { ReactNode, useEffect, useState } from "react";
import { useOffline } from "@/contexts/OfflineContext";
import { idbDelete, idbGet, idbSet } from "@/lib/offlineStorage";

const CACHE_PREFIX = "offline:cache:";

interface CachedEntry<T> {
  data: T;
  savedAt: number;
}

interface OfflineFallbackProps<T> {
  /** Unique key used to persist this page's data in IndexedDB. */
  cacheKey: string;
  /** Fresh data from the network; persisted whenever it changes while online. */
  data: T | undefined;
  children: (data: T) => ReactNode;
  /** Rendered when there is neither fresh nor cached data. */
  empty?: ReactNode;
}

/**
 * Renders fresh data when available and falls back to the last cached copy
 * from IndexedDB when offline, instead of leaving the page blank. Mutations
 * made offline are queued via `useOffline().queueMutation` and auto-synced by
 * OfflineProvider on reconnect; the pending count is surfaced here.
 */
export function OfflineFallback<T>({ cacheKey, data, children, empty }: OfflineFallbackProps<T>) {
  const { isOnline, isSyncing, pendingCount } = useOffline();
  const [cached, setCached] = useState<CachedEntry<T> | undefined>();
  const storageKey = `${CACHE_PREFIX}${cacheKey}`;

  useEffect(() => {
    if (data !== undefined) {
      idbSet<CachedEntry<T>>(storageKey, { data, savedAt: Date.now() }).catch(() => {});
    }
  }, [data, storageKey]);

  useEffect(() => {
    if (data === undefined) {
      idbGet<CachedEntry<T>>(storageKey).then(setCached).catch(() => {});
    }
  }, [data, storageKey]);

  const clearCache = async () => {
    await idbDelete(storageKey).catch(() => {});
    setCached(undefined);
  };

  const showCached = data === undefined && cached !== undefined;
  const content = data ?? cached?.data;

  return (
    <div>
      {(showCached || !isOnline || pendingCount > 0) && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-yellow-600/40 bg-yellow-900/20 px-3 py-2 text-sm text-yellow-200"
        >
          <span>
            {showCached && cached
              ? `Showing cached content from ${new Date(cached.savedAt).toLocaleString()}`
              : isOnline
                ? "Online"
                : "You are offline"}
            {pendingCount > 0 &&
              ` · ${isSyncing ? "Syncing" : "Sync pending"}: ${pendingCount} action${pendingCount > 1 ? "s" : ""}`}
          </span>
          {showCached && (
            <button
              type="button"
              onClick={clearCache}
              className="rounded border border-yellow-600/60 px-2 py-0.5 text-xs hover:bg-yellow-800/40"
            >
              Clear cache
            </button>
          )}
        </div>
      )}
      {content !== undefined ? children(content) : (empty ?? null)}
    </div>
  );
}
