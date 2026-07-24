/**
 * VirtualGrid
 *
 * A virtualised responsive grid backed by react-window's FixedSizeGrid.
 * Automatically computes the number of columns from a container ResizeObserver
 * and the `columnMinWidth` prop, replicating CSS `grid-cols-auto-fill`.
 *
 * Usage:
 *   <VirtualGrid
 *     items={tournaments}
 *     columnMinWidth={320}
 *     rowHeight={320}
 *     height={640}
 *     gap={24}
 *     renderItem={({ item, style }) => (
 *       <div style={style}><TournamentCard tournament={item} /></div>
 *     )}
 *   />
 */
"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  CSSProperties,
} from "react";
import { FixedSizeGrid, GridChildComponentProps } from "react-window";
import { useVirtualScrollAnalytics } from "@/hooks/useVirtualScrollAnalytics";
import { cn } from "@/lib/utils";

export interface VirtualGridRenderProps<T> {
  item: T;
  rowIndex: number;
  columnIndex: number;
  /** Must be spread onto the outermost element */
  style: CSSProperties;
}

export interface VirtualGridProps<T> {
  listId: string;
  items: T[];
  /** Minimum column width in pixels — columns auto-fill based on container width */
  columnMinWidth?: number;
  /** Fixed height of every row in pixels */
  rowHeight?: number;
  /** Pixel height of the scroll container */
  height?: number;
  /** Gap between cells in pixels (applied as padding inside each cell) */
  gap?: number;
  overscanRowCount?: number;
  renderItem: (props: VirtualGridRenderProps<T>) => React.ReactNode;
  onLoadMore?: () => void;
  loadMoreThreshold?: number;
  loadingIndicator?: React.ReactNode;
  emptyState?: React.ReactNode;
  className?: string;
}

export function VirtualGrid<T>({
  listId,
  items,
  columnMinWidth = 300,
  rowHeight = 320,
  height = 640,
  gap = 24,
  overscanRowCount = 2,
  renderItem,
  onLoadMore,
  loadMoreThreshold = 400,
  loadingIndicator,
  emptyState,
  className,
}: VirtualGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const analytics = useVirtualScrollAnalytics(listId);
  const hasFiredMountRef = useRef(false);

  // Observe container width changes for responsive column count
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) setContainerWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columnCount = containerWidth > 0
    ? Math.max(1, Math.floor((containerWidth + gap) / (columnMinWidth + gap)))
    : 1;

  const columnWidth = containerWidth > 0
    ? Math.floor((containerWidth - gap * (columnCount - 1)) / columnCount)
    : columnMinWidth;

  const rowCount = Math.ceil(items.length / columnCount);

  useEffect(() => {
    analytics.trackMountStart();
  }, [analytics]);

  useEffect(() => {
    if (!hasFiredMountRef.current && items.length > 0 && containerWidth > 0) {
      hasFiredMountRef.current = true;
      const visibleRows = Math.ceil(height / rowHeight);
      analytics.trackMountComplete(items.length, Math.min(visibleRows * columnCount, items.length));
    }
  }, [items.length, height, rowHeight, columnCount, containerWidth, analytics]);

  const handleScroll = useCallback(
    ({ scrollTop }: { scrollTop: number }) => {
      const totalHeight = rowCount * rowHeight;
      const visible = Math.ceil(height / rowHeight) * columnCount;
      analytics.trackScroll(scrollTop, totalHeight, visible);

      if (onLoadMore) {
        const distanceFromBottom = totalHeight - scrollTop - height;
        if (distanceFromBottom < loadMoreThreshold) {
          onLoadMore();
        }
      }
    },
    [rowCount, rowHeight, height, columnCount, analytics, onLoadMore, loadMoreThreshold]
  );

  if (items.length === 0 && emptyState) return <>{emptyState}</>;

  const Cell = useCallback(
    ({ rowIndex, columnIndex, style }: GridChildComponentProps) => {
      const index = rowIndex * columnCount + columnIndex;
      const item = items[index];
      if (item === undefined) return null;

      // Apply gap via inset padding on the cell wrapper
      const cellStyle: CSSProperties = {
        ...style,
        left: (style.left as number) + (columnIndex === 0 ? 0 : gap / 2),
        top: (style.top as number) + (rowIndex === 0 ? 0 : gap / 2),
        width: (style.width as number) - (columnIndex === 0 || columnIndex === columnCount - 1 ? gap / 2 : gap),
        height: (style.height as number) - (rowIndex === 0 ? 0 : gap / 2),
        padding: 0,
      };

      return (
        <>{renderItem({ item, rowIndex, columnIndex, style: cellStyle })}</>
      );
    },
    [items, columnCount, gap, renderItem]
  );

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {containerWidth > 0 && (
        <FixedSizeGrid
          columnCount={columnCount}
          columnWidth={columnWidth}
          rowCount={rowCount}
          rowHeight={rowHeight}
          height={height}
          width={containerWidth}
          overscanRowCount={overscanRowCount}
          onScroll={handleScroll}
        >
          {Cell}
        </FixedSizeGrid>
      )}
      {loadingIndicator ?? null}
    </div>
  );
}
