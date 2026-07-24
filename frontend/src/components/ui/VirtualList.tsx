/**
 * VirtualList
 *
 * A fixed-height virtualised list backed by react-window's FixedSizeList.
 * Renders only the rows visible in the viewport plus an overscan buffer,
 * keeping memory and DOM node counts constant regardless of list length.
 *
 * For variable-height rows see VirtualDynamicList.
 *
 * Usage:
 *   <VirtualList
 *     items={entries}
 *     itemHeight={64}
 *     height={480}
 *     renderItem={({ item, index, style }) => (
 *       <div style={style}>...</div>
 *     )}
 *   />
 */
"use client";

import React, { forwardRef, useCallback, useEffect, useRef, CSSProperties } from "react";
import { FixedSizeList, ListChildComponentProps, FixedSizeList as FixedSizeListType } from "react-window";
import { useVirtualScrollAnalytics } from "@/hooks/useVirtualScrollAnalytics";
import { cn } from "@/lib/utils";

export interface VirtualListRenderProps<T> {
  item: T;
  index: number;
  /** Must be spread onto the outermost element of each row */
  style: CSSProperties;
}

export interface VirtualListProps<T> {
  /** Unique identifier used for analytics */
  listId: string;
  items: T[];
  /** Fixed pixel height for every row */
  itemHeight: number;
  /** Pixel height of the scroll container. Defaults to 480. */
  height?: number;
  /** Number of extra rows to render above and below the visible area */
  overscanCount?: number;
  /** Render function for each row */
  renderItem: (props: VirtualListRenderProps<T>) => React.ReactNode;
  /** Called when the user scrolls near the bottom — wire to infinite scroll */
  onLoadMore?: () => void;
  /** Distance from bottom (px) at which onLoadMore fires */
  loadMoreThreshold?: number;
  /** Rendered below the last item while a page is loading */
  loadingIndicator?: React.ReactNode;
  /** Rendered when items is empty */
  emptyState?: React.ReactNode;
  className?: string;
  /** Extra class applied to the outer scroll container */
  outerClassName?: string;
}

// Default loading spinner shown at the bottom of the list
function DefaultLoadingIndicator() {
  return (
    <div className="flex justify-center items-center py-4" aria-busy="true" aria-label="Loading more items">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function VirtualListInner<T>(
  {
    listId,
    items,
    itemHeight,
    height = 480,
    overscanCount = 5,
    renderItem,
    onLoadMore,
    loadMoreThreshold = 300,
    loadingIndicator,
    emptyState,
    className,
    outerClassName,
  }: VirtualListProps<T>,
  ref: React.ForwardedRef<FixedSizeListType>
) {
  const listRef = useRef<FixedSizeListType>(null);
  const analytics = useVirtualScrollAnalytics(listId);
  const hasFiredMountRef = useRef(false);

  // Forward the ref
  const setRefs = useCallback(
    (node: FixedSizeListType | null) => {
      (listRef as React.MutableRefObject<FixedSizeListType | null>).current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<FixedSizeListType | null>).current = node;
    },
    [ref]
  );

  // Track mount start immediately
  useEffect(() => {
    analytics.trackMountStart();
  }, [analytics]);

  // Track mount complete after first render
  useEffect(() => {
    if (!hasFiredMountRef.current && items.length > 0) {
      hasFiredMountRef.current = true;
      const visible = Math.ceil(height / itemHeight);
      analytics.trackMountComplete(items.length, Math.min(visible + overscanCount, items.length));
    }
  }, [items.length, height, itemHeight, overscanCount, analytics]);

  const handleScroll = useCallback(
    ({ scrollOffset }: { scrollOffset: number }) => {
      const totalHeight = items.length * itemHeight;
      const visible = Math.ceil(height / itemHeight);
      analytics.trackScroll(scrollOffset, totalHeight, visible);

      // Infinite scroll trigger
      if (onLoadMore) {
        const distanceFromBottom = totalHeight - scrollOffset - height;
        if (distanceFromBottom < loadMoreThreshold) {
          onLoadMore();
        }
      }
    },
    [items.length, itemHeight, height, analytics, onLoadMore, loadMoreThreshold]
  );

  if (items.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  // react-window row renderer — must be a stable reference
  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item = items[index];
      if (item === undefined) return null;
      return <>{renderItem({ item, index, style })}</>;
    },
    [items, renderItem]
  );

  return (
    <div className={cn("relative", className)} role="list" aria-label={listId}>
      <FixedSizeList
        ref={setRefs}
        height={height}
        itemCount={items.length}
        itemSize={itemHeight}
        width="100%"
        overscanCount={overscanCount}
        onScroll={handleScroll}
        outerElementType={outerClassName ? OuterElement(outerClassName) : undefined}
      >
        {Row}
      </FixedSizeList>
      {loadingIndicator !== undefined
        ? loadingIndicator
        : onLoadMore
        ? <DefaultLoadingIndicator />
        : null}
    </div>
  );
}

// Helper to pass a className to react-window's outer container
function OuterElement(className: string) {
  return forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    (props, ref) => <div ref={ref} {...props} className={cn(props.className, className)} />
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: React.ForwardedRef<FixedSizeListType> }
) => React.ReactElement;
