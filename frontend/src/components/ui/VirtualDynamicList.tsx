/**
 * VirtualDynamicList
 *
 * A virtualised list for items with variable row heights, backed by
 * react-window's VariableSizeList. Pass an `estimatedItemSize` for initial
 * layout; the list adjusts as rows mount and report their measured heights.
 *
 * Usage:
 *   <VirtualDynamicList
 *     items={matches}
 *     estimatedItemSize={88}
 *     height={560}
 *     renderItem={({ item, index, style, measureRef }) => (
 *       <div style={style}>
 *         <div ref={measureRef}>...content...</div>
 *       </div>
 *     )}
 *   />
 */
"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  CSSProperties,
} from "react";
import { VariableSizeList, ListChildComponentProps } from "react-window";
import { useVirtualScrollAnalytics } from "@/hooks/useVirtualScrollAnalytics";
import { cn } from "@/lib/utils";

export interface VirtualDynamicListRenderProps<T> {
  item: T;
  index: number;
  /** Must be spread onto the outermost element */
  style: CSSProperties;
  /**
   * Attach to the inner content wrapper (not the style element) so the
   * ResizeObserver can measure the true rendered height and update the list.
   */
  measureRef: (node: HTMLElement | null) => void;
}

export interface VirtualDynamicListProps<T> {
  listId: string;
  items: T[];
  /** Used for initial layout before measurements are available */
  estimatedItemSize: number;
  height?: number;
  overscanCount?: number;
  renderItem: (props: VirtualDynamicListRenderProps<T>) => React.ReactNode;
  onLoadMore?: () => void;
  loadMoreThreshold?: number;
  loadingIndicator?: React.ReactNode;
  emptyState?: React.ReactNode;
  className?: string;
}

export function VirtualDynamicList<T>({
  listId,
  items,
  estimatedItemSize,
  height = 480,
  overscanCount = 3,
  renderItem,
  onLoadMore,
  loadMoreThreshold = 300,
  loadingIndicator,
  emptyState,
  className,
}: VirtualDynamicListProps<T>) {
  const listRef = useRef<VariableSizeList>(null);
  const analytics = useVirtualScrollAnalytics(listId);
  const hasFiredMountRef = useRef(false);

  // Cache of measured heights keyed by index
  const heightCacheRef = useRef<Record<number, number>>({});

  // ResizeObserver instances keyed by index
  const observersRef = useRef<Record<number, ResizeObserver>>({});

  useEffect(() => {
    analytics.trackMountStart();
  }, [analytics]);

  useEffect(() => {
    if (!hasFiredMountRef.current && items.length > 0) {
      hasFiredMountRef.current = true;
      const visible = Math.ceil(height / estimatedItemSize);
      analytics.trackMountComplete(items.length, Math.min(visible + overscanCount, items.length));
    }
  }, [items.length, height, estimatedItemSize, overscanCount, analytics]);

  // Reset cache when the items array reference changes (filter/sort applied)
  useEffect(() => {
    heightCacheRef.current = {};
    listRef.current?.resetAfterIndex(0);
  }, [items]);

  const getItemSize = useCallback(
    (index: number) => heightCacheRef.current[index] ?? estimatedItemSize,
    [estimatedItemSize]
  );

  /**
   * measureRef callback factory — creates a ResizeObserver per row that
   * updates the height cache and tells react-window to recompute.
   */
  const makeMeasureRef = useCallback(
    (index: number) => (node: HTMLElement | null) => {
      // Disconnect any previous observer for this index
      observersRef.current[index]?.disconnect();
      if (!node) return;

      const observer = new ResizeObserver(([entry]) => {
        const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height ?? 0;
        if (height > 0 && heightCacheRef.current[index] !== height) {
          heightCacheRef.current[index] = height;
          listRef.current?.resetAfterIndex(index);
        }
      });
      observer.observe(node);
      observersRef.current[index] = observer;
    },
    []
  );

  // Clean up observers on unmount
  useEffect(() => {
    const observers = observersRef.current;
    return () => {
      Object.values(observers).forEach((o) => o.disconnect());
    };
  }, []);

  const handleScroll = useCallback(
    ({ scrollOffset }: { scrollOffset: number }) => {
      const totalHeight = items.length * estimatedItemSize;
      const visible = Math.ceil(height / estimatedItemSize);
      analytics.trackScroll(scrollOffset, totalHeight, visible);

      if (onLoadMore) {
        const distanceFromBottom = totalHeight - scrollOffset - height;
        if (distanceFromBottom < loadMoreThreshold) {
          onLoadMore();
        }
      }
    },
    [items.length, estimatedItemSize, height, analytics, onLoadMore, loadMoreThreshold]
  );

  if (items.length === 0 && emptyState) return <>{emptyState}</>;

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item = items[index];
      if (item === undefined) return null;
      return (
        <>
          {renderItem({ item, index, style, measureRef: makeMeasureRef(index) })}
        </>
      );
    },
    [items, renderItem, makeMeasureRef]
  );

  return (
    <div className={cn("relative", className)} role="list" aria-label={listId}>
      <VariableSizeList
        ref={listRef}
        height={height}
        itemCount={items.length}
        itemSize={getItemSize}
        estimatedItemSize={estimatedItemSize}
        width="100%"
        overscanCount={overscanCount}
        onScroll={handleScroll}
      >
        {Row}
      </VariableSizeList>
      {loadingIndicator ?? null}
    </div>
  );
}
