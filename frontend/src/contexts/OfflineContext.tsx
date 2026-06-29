"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import {
  enqueueSync,
  flushSyncQueue,
  getSyncQueueLength,
  SyncItem,
} from "@/lib/syncQueue";
import { flushAnalyticsQueue, enqueueAnalytics } from "@/lib/analyticsQueue";

interface OfflineContextValue {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  queueMutation: (item: Omit<SyncItem, "id" | "timestamp">) => Promise<void>;
  trackEvent: (name: string, props?: Record<string, unknown>) => void;
}

const OfflineContext = createContext<OfflineContextValue | undefined>(undefined);

export function useOffline(): OfflineContextValue {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error("useOffline must be used inside OfflineProvider");
  return ctx;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const { isOnline } = useNetworkStatus();
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const prevOnline = useRef(isOnline);

  // Refresh pending count whenever online state changes
  useEffect(() => {
    getSyncQueueLength().then(setPendingCount);
  }, [isOnline]);

  // When coming back online, flush both queues
  useEffect(() => {
    if (isOnline && !prevOnline.current) {
      setIsSyncing(true);
      Promise.all([
        flushSyncQueue((remaining) => setPendingCount(remaining)),
        flushAnalyticsQueue(),
      ]).finally(() => {
        setIsSyncing(false);
        getSyncQueueLength().then(setPendingCount);
      });
    }
    prevOnline.current = isOnline;
  }, [isOnline]);

  const queueMutation = useCallback(
    async (item: Omit<SyncItem, "id" | "timestamp">) => {
      await enqueueSync(item);
      setPendingCount((n) => n + 1);
    },
    []
  );

  const trackEvent = useCallback(
    (name: string, props?: Record<string, unknown>) => {
      enqueueAnalytics({ name, props, timestamp: Date.now() });
      if (isOnline) flushAnalyticsQueue();
    },
    [isOnline]
  );

  return (
    <OfflineContext.Provider
      value={{ isOnline, isSyncing, pendingCount, queueMutation, trackEvent }}
    >
      {children}
    </OfflineContext.Provider>
  );
}
