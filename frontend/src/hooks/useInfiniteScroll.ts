import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInfiniteScrollOptions<T> {
  /** Async function that fetches one page. Receives the cursor for the next page, or undefined for the first page. */
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | undefined }>;
  /** Intersection Observer rootMargin (default "0px 0px 200px 0px" — preload 200px before the sentinel). */
  rootMargin?: string;
}

export interface UseInfiniteScrollResult<T> {
  items: T[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  /** Ref to attach to the scroll sentinel element. */
  sentinelRef: (node: Element | null) => void;
  /** Reset list and refetch from the first page. */
  reset: () => void;
}

export function useInfiniteScroll<T>({
  fetchPage,
  rootMargin = '0px 0px 200px 0px',
}: UseInfiniteScrollOptions<T>): UseInfiniteScrollResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const cursorRef = useRef<string | undefined>(undefined);
  const loadingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelNodeRef = useRef<Element | null>(null);

  const loadNext = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const { items: newItems, nextCursor } = await fetchPage(cursorRef.current);
      cursorRef.current = nextCursor;
      setItems((prev) => [...prev, ...newItems]);
      setHasMore(nextCursor != null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [fetchPage, hasMore]);

  const disconnect = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, []);

  const sentinelRef = useCallback(
    (node: Element | null) => {
      disconnect();
      sentinelNodeRef.current = node;
      if (!node) return;
      observerRef.current = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) void loadNext();
        },
        { rootMargin },
      );
      observerRef.current.observe(node);
    },
    [disconnect, loadNext, rootMargin],
  );

  const reset = useCallback(() => {
    disconnect();
    cursorRef.current = undefined;
    loadingRef.current = false;
    setItems([]);
    setError(null);
    setHasMore(true);
    setLoading(false);
  }, [disconnect]);

  // Kick off the first load on mount.
  useEffect(() => {
    void loadNext();
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { items, loading, error, hasMore, sentinelRef, reset };
}
