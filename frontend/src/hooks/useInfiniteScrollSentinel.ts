import { useCallback, useEffect, useRef } from "react";

/**
 * Props-driven infinite-scroll sentinel — issue #888.
 *
 * Unlike {@link useInfiniteScroll} (which owns its data via a `fetchPage`
 * callback), this hook is deliberately *presentational*: the parent owns the
 * item list and the loading flag, and this hook only decides *when* to ask for
 * the next batch. That makes it a drop-in for components like `MatchHistory`
 * that already receive `matches` / `onLoadMore` / `isLoadingMore` as props.
 *
 * Responsibilities:
 *  - observe a sentinel element and call `onLoadMore` when it nears the viewport
 *    (IntersectionObserver, so no scroll-event thrashing);
 *  - prevent duplicate/overlapping requests via an internal "pending" gate that
 *    only releases once a new batch arrives (`itemCount` grows) or the current
 *    load resolves (`isLoading` falls back to false);
 *  - measure each batch's latency and surface it via `onBatchLoad`, warning in
 *    development when it exceeds `budgetMs` (300ms per the acceptance criteria).
 */
export interface InfiniteScrollSentinelOptions {
  /** Ask the parent to load the next batch. */
  onLoadMore?: () => void;
  /** Whether more items remain. When false the observer is torn down. */
  hasMore: boolean;
  /** Parent-managed loading flag; blocks re-triggering mid-request. */
  isLoading: boolean;
  /**
   * Number of items currently loaded (pre-filtering). Used both to detect that
   * a requested batch has arrived and to gate against duplicate requests.
   */
  itemCount: number;
  /** Master switch — when false the hook is inert. Default true. */
  enabled?: boolean;
  /** IntersectionObserver rootMargin; pre-loads before the sentinel is visible. */
  rootMargin?: string;
  /** Optional scroll container; defaults to the viewport. */
  root?: Element | null;
  /** Notified with the elapsed ms each time a batch arrives. */
  onBatchLoad?: (durationMs: number) => void;
  /** Latency budget for a dev-only warning. Default 300ms. */
  budgetMs?: number;
}

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : 0;

export interface InfiniteScrollSentinelResult {
  /** Attach to a small element rendered at the end of the list. */
  sentinelRef: React.RefObject<HTMLDivElement>;
}

export function useInfiniteScrollSentinel({
  onLoadMore,
  hasMore,
  isLoading,
  itemCount,
  enabled = true,
  rootMargin = "300px",
  root = null,
  onBatchLoad,
  budgetMs = 300,
}: InfiniteScrollSentinelOptions): InfiniteScrollSentinelResult {
  const sentinelRef = useRef<HTMLDivElement>(null);
  // True while a request we triggered is still outstanding. Gates re-fires so
  // a sentinel that stays on-screen can't stack duplicate loads.
  const pendingRef = useRef(false);
  const startRef = useRef<number | null>(null);
  const lastCountRef = useRef(itemCount);

  const fire = useCallback(() => {
    if (!enabled || !onLoadMore || !hasMore || isLoading || pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    startRef.current = nowMs();
    onLoadMore();
  }, [enabled, onLoadMore, hasMore, isLoading]);

  // A batch arrived (item count grew): measure latency and release the gate.
  useEffect(() => {
    if (itemCount > lastCountRef.current) {
      if (pendingRef.current && startRef.current !== null) {
        const duration = nowMs() - startRef.current;
        onBatchLoad?.(duration);
        if (process.env.NODE_ENV !== "production" && duration > budgetMs) {
          // eslint-disable-next-line no-console
          console.warn(
            `[useInfiniteScrollSentinel] batch took ${Math.round(
              duration
            )}ms (> ${budgetMs}ms budget)`
          );
        }
      }
      pendingRef.current = false;
      startRef.current = null;
    }
    lastCountRef.current = itemCount;
  }, [itemCount, onBatchLoad, budgetMs]);

  // A load finished without adding items (end of list / error): release the gate
  // so a later intersection can retry.
  useEffect(() => {
    if (!isLoading) {
      pendingRef.current = false;
      startRef.current = null;
    }
  }, [isLoading]);

  useEffect(() => {
    if (!enabled || !hasMore) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) fire();
      },
      { root, rootMargin }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, hasMore, root, rootMargin, fire]);

  return { sentinelRef };
}

export default useInfiniteScrollSentinel;
