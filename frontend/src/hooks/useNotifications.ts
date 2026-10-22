'use client';

/**
 * Issue #1410 — In-app notification centre hook.
 *
 * Provides:
 * - Cursor-based infinite pagination via TanStack Query useInfiniteQuery
 * - Per-notification markRead mutation
 * - markAllRead mutation
 * - prependNotification() for WebSocket push (no full refetch)
 * - Unread badge count capped at 99+
 */

import { useCallback } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  InfiniteData,
} from '@tanstack/react-query';
import { pinnedFetch } from '@/api/certificatePinning';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppNotification {
  id: string;
  type: 'match' | 'tournament' | 'wallet' | 'system' | 'achievement';
  title: string;
  body: string;
  read: boolean;
  createdAt: string; // ISO 8601
  href?: string;
}

interface NotificationsPage {
  items: AppNotification[];
  /** Cursor for the next page, or null when there are no more pages. */
  nextCursor: string | null;
  /** Total unread count across all pages (from the server). */
  unreadCount: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

async function fetchPage(cursor: string | null): Promise<NotificationsPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  const res = await pinnedFetch(`/api/v1/notifications?${params}`);
  if (!res.ok) throw new Error('Failed to fetch notifications');
  return res.json() as Promise<NotificationsPage>;
}

async function markOneRead(id: string): Promise<void> {
  const res = await pinnedFetch(`/api/v1/notifications/${id}/read`, {
    method: 'PATCH',
  });
  if (!res.ok) throw new Error('Failed to mark notification read');
}

async function markAllReadApi(): Promise<void> {
  const res = await pinnedFetch('/api/v1/notifications/read-all', {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to mark all notifications read');
}

// ─── Query key ────────────────────────────────────────────────────────────────

export const NOTIFICATIONS_QUERY_KEY = ['notifications'] as const;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useNotifications() {
  const queryClient = useQueryClient();

  // ── Infinite query ──────────────────────────────────────────────────────────
  const query = useInfiniteQuery({
    queryKey: NOTIFICATIONS_QUERY_KEY,
    queryFn: ({ pageParam }) => fetchPage(pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // Flatten all pages into a single ordered list
  const notifications: AppNotification[] =
    query.data?.pages.flatMap((p) => p.items) ?? [];

  // The server returns a fresh unreadCount on every page; the first page has
  // the most accurate figure because it's the most recently fetched.
  const unreadCount: number = query.data?.pages[0]?.unreadCount ?? 0;
  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const markReadMutation = useMutation({
    mutationFn: markOneRead,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllReadApi,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_QUERY_KEY }),
  });

  // ── WebSocket push helper ──────────────────────────────────────────────────

  /**
   * Prepend a notification that arrived via WebSocket at the top of the list
   * without triggering a full server refetch.
   */
  const prependNotification = useCallback(
    (notification: AppNotification) => {
      queryClient.setQueryData<InfiniteData<NotificationsPage>>(
        NOTIFICATIONS_QUERY_KEY,
        (old) => {
          if (!old) return old;
          const [firstPage, ...rest] = old.pages;
          const updatedFirstPage: NotificationsPage = {
            ...firstPage,
            items: [notification, ...firstPage.items],
            unreadCount: firstPage.unreadCount + 1,
          };
          return { ...old, pages: [updatedFirstPage, ...rest] };
        }
      );
    },
    [queryClient]
  );

  return {
    notifications,
    unreadCount,
    badgeLabel,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: !!query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    markRead: (id: string) => markReadMutation.mutate(id),
    markAllRead: () => markAllReadMutation.mutate(),
    prependNotification,
    refetch: query.refetch,
  };
}
