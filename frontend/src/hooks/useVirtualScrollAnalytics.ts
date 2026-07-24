/**
 * useVirtualScrollAnalytics
 *
 * Tracks virtual list performance and scroll behaviour.
 * Reports rendered item counts, scroll position percentages, and
 * time-to-first-render. Integrates with Datadog RUM and the existing
 * analytics infrastructure.
 */
"use client";

import { useCallback, useRef } from "react";

type VirtualScrollEvent =
  | { type: "virtual_list_mount"; listId: string; totalItems: number; visibleItems: number; renderMs: number }
  | { type: "virtual_list_scroll"; listId: string; scrollPercent: number; visibleItems: number }
  | { type: "virtual_list_load_more"; listId: string; loadedItems: number; totalItems: number }
  | { type: "virtual_list_item_click"; listId: string; itemIndex: number };

function sendEvent(event: VirtualScrollEvent) {
  if (
    typeof window !== "undefined" &&
    // @ts-expect-error — DD_RUM injected by @datadog/browser-rum
    typeof window.DD_RUM !== "undefined"
  ) {
    // @ts-expect-error
    window.DD_RUM.addAction(`virtual_scroll.${event.type}`, event);
    return;
  }
  if (process.env.NODE_ENV === "development") {
    console.debug("[VirtualScrollAnalytics]", event);
  }
}

export function useVirtualScrollAnalytics(listId: string) {
  const mountTimeRef = useRef<number | null>(null);
  const lastScrollPercentRef = useRef<number>(0);

  /** Call as early as possible in the component lifecycle */
  const trackMountStart = useCallback(() => {
    mountTimeRef.current = performance.now();
  }, []);

  /** Call once the list has rendered its first set of items */
  const trackMountComplete = useCallback(
    (totalItems: number, visibleItems: number) => {
      const renderMs = mountTimeRef.current
        ? Math.round(performance.now() - mountTimeRef.current)
        : 0;
      sendEvent({ type: "virtual_list_mount", listId, totalItems, visibleItems, renderMs });
    },
    [listId]
  );

  /**
   * Call from the onScroll handler of the virtualised list.
   * @param scrollOffset  Current pixel offset from the top
   * @param totalHeight   Total scrollable height in pixels
   * @param visibleItems  Number of currently rendered items
   */
  const trackScroll = useCallback(
    (scrollOffset: number, totalHeight: number, visibleItems: number) => {
      if (totalHeight === 0) return;
      const scrollPercent = Math.round((scrollOffset / totalHeight) * 100);
      // Only fire when the scroll % changes by ≥5 to avoid flooding
      if (Math.abs(scrollPercent - lastScrollPercentRef.current) < 5) return;
      lastScrollPercentRef.current = scrollPercent;
      sendEvent({ type: "virtual_list_scroll", listId, scrollPercent, visibleItems });
    },
    [listId]
  );

  /** Call when infinite scroll fetches a new page */
  const trackLoadMore = useCallback(
    (loadedItems: number, totalItems: number) => {
      sendEvent({ type: "virtual_list_load_more", listId, loadedItems, totalItems });
    },
    [listId]
  );

  /** Call when a list item is clicked */
  const trackItemClick = useCallback(
    (itemIndex: number) => {
      sendEvent({ type: "virtual_list_item_click", listId, itemIndex });
    },
    [listId]
  );

  return {
    trackMountStart,
    trackMountComplete,
    trackScroll,
    trackLoadMore,
    trackItemClick,
  };
}
