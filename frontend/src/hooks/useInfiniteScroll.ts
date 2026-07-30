import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInfiniteScrollOptions<T> {
  /** Async function that fetches one page. Receives the cursor for the next page, or undefined for the first page. */
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | undefined }>;
  /** Intersection Observer rootMargin (default "0px 0px 200px 0px" — preload 200px before the sentinel). */
  rootMargin?: string;
  /** Enable performance optimizations (default: true). */
  enableOptimizations?: boolean;
  /** Threshold for enabling virtualization (default: 20 items). */
  virtualizationThreshold?: number;
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
  /** Performance metrics. */
  metrics: {
    totalItems: number;
    loadedPages: number;
    averageLoadTime: number;
    shouldVirtualize: boolean;
  };
}

export function useInfiniteScroll<T>({
  fetchPage,
  rootMargin = '0px 0px 200px 0px',
  enableOptimizations = true,
  virtualizationThreshold = 20,
}: UseInfiniteScrollOptions<T>): UseInfiniteScrollResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const cursorRef = useRef<string | undefined>(undefined);
  const loadingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelNodeRef = useRef<Element | null>(null);
  
  // Performance tracking
  const loadTimesRef = useRef<number[]>([]);
  const pagesLoadedRef = useRef(0);
  const lastLoadTimeRef = useRef<number>(0);

  // Throttle intersection events to prevent excessive loading
  const throttleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isThrottledRef = useRef(false);

  const loadNext = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    
    // Throttle rapid scroll events
    if (enableOptimizations && isThrottledRef.current) {
      return;
    }

    loadingRef.current = true;
    setLoading(true);
    setError(null);
    
    const startTime = performance.now();
    
    try {
      const { items: newItems, nextCursor } = await fetchPage(cursorRef.current);
      
      const loadTime = performance.now() - startTime;
      loadTimesRef.current.push(loadTime);
      if (loadTimesRef.current.length > 10) {
        loadTimesRef.current.shift(); // Keep only last 10 load times
      }
      
      cursorRef.current = nextCursor;
      pagesLoadedRef.current += 1;
      lastLoadTimeRef.current = loadTime;
      
      setItems((prev) => {
        // Use optimized array concatenation for large arrays
        if (enableOptimizations && prev.length > 100) {
          const result = new Array(prev.length + newItems.length);
          for (let i = 0; i < prev.length; i++) {
            result[i] = prev[i];
          }
          for (let i = 0; i < newItems.length; i++) {
            result[prev.length + i] = newItems[i];
          }
          return result;
        }
        return [...prev, ...newItems];
      });
      
      setHasMore(nextCursor != null);
      
      // Throttle next load attempt
      if (enableOptimizations) {
        isThrottledRef.current = true;
        throttleTimeoutRef.current = setTimeout(() => {
          isThrottledRef.current = false;
        }, 200); // 200ms throttle
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [fetchPage, hasMore, enableOptimizations]);

  const disconnect = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (throttleTimeoutRef.current) {
      clearTimeout(throttleTimeoutRef.current);
      throttleTimeoutRef.current = null;
    }
  }, []);

  const sentinelRef = useCallback(
    (node: Element | null) => {
      disconnect();
      sentinelNodeRef.current = node;
      if (!node) return;
      
      // Use optimized IntersectionObserver configuration
      observerRef.current = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting && !loadingRef.current) {
            // Use requestAnimationFrame for smoother performance
            if (enableOptimizations) {
              requestAnimationFrame(() => {
                void loadNext();
              });
            } else {
              void loadNext();
            }
          }
        },
        { 
          rootMargin,
          // Adjust threshold for better performance
          threshold: 0.1,
        },
      );
      observerRef.current.observe(node);
    },
    [disconnect, loadNext, rootMargin, enableOptimizations],
  );

  const reset = useCallback(() => {
    disconnect();
    cursorRef.current = undefined;
    loadingRef.current = false;
    isThrottledRef.current = false;
    loadTimesRef.current = [];
    pagesLoadedRef.current = 0;
    lastLoadTimeRef.current = 0;
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

  // Calculate performance metrics
  const averageLoadTime =
    loadTimesRef.current.length > 0
      ? loadTimesRef.current.reduce((a, b) => a + b, 0) / loadTimesRef.current.length
      : 0;

  return {
    items,
    loading,
    error,
    hasMore,
    sentinelRef,
    reset,
    metrics: {
      totalItems: items.length,
      loadedPages: pagesLoadedRef.current,
      averageLoadTime: Math.round(averageLoadTime),
      shouldVirtualize: items.length >= virtualizationThreshold,
    },
  };
}
