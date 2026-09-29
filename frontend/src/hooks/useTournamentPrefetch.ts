/**
 * useTournamentPrefetch — Issue #1099
 *
 * React Query prefetching on hover/focus for tournament cards.
 *
 * Prefetches the tournament detail query in the background after a card has
 * been hovered/focused for a short debounce window, so that by the time the
 * user clicks through the data is already cached and the detail page renders
 * instantly (no 300-800ms blank loading state).
 *
 * Behaviour:
 * - Debounced: 150ms delay before prefetching to avoid prefetching cards the
 *   user is just scrolling past.
 * - Concurrency cap: at most 3 in-flight prefetch requests across all cards
 *   on the page; when the cap is exceeded the oldest request is cancelled.
 * - Touch devices: `touchstart` fires before the synthetic `mouseenter`, so
 *   hooking touchstart gives the same "prefetch before tap" behaviour.
 * - Prefetched data is subject to a 30s staleTime so recent navigations reuse
 *   the cache instead of re-fetching.
 */

"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { QK } from "@/data/queries";
import { apiClient } from "@/data/apiClient";
import type { Tournament } from "@/types/tournament";

const PREFETCH_DEBOUNCE_MS = 150;
const MAX_CONCURRENT_PREFETCHES = 3;
const PREFETCH_STALE_TIME_MS = 30_000;

// Module-scoped registry so the concurrency cap applies across every
// tournament card mounted on the page (each card owns its own hook instance).
const activePrefetches = new Map<string, number>();
let prefetchSequence = 0;

/** Test helper — clears the module-level prefetch registry between tests. */
export function resetTournamentPrefetchRegistry(): void {
  activePrefetches.clear();
  prefetchSequence = 0;
}

export function useTournamentPrefetch() {
  const queryClient = useQueryClient();
  const debounceTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (debounceTimer.current != null) {
        window.clearTimeout(debounceTimer.current);
      }
    },
    [],
  );

  const cancelScheduled = useCallback(() => {
    if (debounceTimer.current != null) {
      window.clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  const prefetch = useCallback(
    (tournamentId: string) => {
      // Enforce the concurrency cap: cancel the oldest in-flight prefetch.
      if (activePrefetches.size >= MAX_CONCURRENT_PREFETCHES) {
        let oldestId: string | null = null;
        let oldestSequence = Number.POSITIVE_INFINITY;
        for (const [id, seq] of activePrefetches) {
          if (seq < oldestSequence) {
            oldestSequence = seq;
            oldestId = id;
          }
        }
        if (oldestId) {
          activePrefetches.delete(oldestId);
          void queryClient.cancelQueries({ queryKey: QK.tournaments.detail(oldestId) });
        }
      }

      prefetchSequence += 1;
      activePrefetches.set(tournamentId, prefetchSequence);

      void queryClient
        .prefetchQuery({
          queryKey: QK.tournaments.detail(tournamentId),
          queryFn: () => apiClient.getEnveloped<Tournament>(`/tournaments/${tournamentId}`),
          staleTime: PREFETCH_STALE_TIME_MS,
        })
        .catch(() => {
          // Prefetch failures are non-fatal — the user can still navigate and
          // the detail page will fetch normally.
        })
        .finally(() => {
          activePrefetches.delete(tournamentId);
        });
    },
    [queryClient],
  );

  const schedule = useCallback(
    (tournamentId: string) => {
      if (debounceTimer.current != null) {
        window.clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = window.setTimeout(() => {
        debounceTimer.current = null;
        prefetch(tournamentId);
      }, PREFETCH_DEBOUNCE_MS);
    },
    [prefetch],
  );

  return { schedule, cancelScheduled };
}