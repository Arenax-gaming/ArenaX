# Virtual Scrolling Architecture

Large data lists in ArenaX use **react-window** to keep the DOM node count constant regardless of dataset size. Only the rows visible in the viewport (plus an overscan buffer) are mounted, which eliminates the performance and memory cost of rendering thousands of nodes upfront.

---

## Library choice

| Library | Bundle size | Dynamic heights | Grid | Decision |
|---|---|---|---|---|
| `react-window` | ~15 KB | Via `VariableSizeList` | `FixedSizeGrid` | ✅ Chosen — smallest footprint, well-maintained |
| `react-virtualized` | ~100 KB | ✅ | ✅ | Not chosen — too heavy for the marginal feature gain |
| `@tanstack/virtual` | ~5 KB | ✅ | Manual | Considered but requires more wiring |

---

## Components

### `VirtualList<T>` — `src/components/ui/VirtualList.tsx`

Fixed row height list. Best for leaderboards, friends list, notification feeds where every row is identical in height.

```tsx
<VirtualList
  listId="leaderboard-table"   // used for analytics
  items={entries}
  itemHeight={56}              // px — must match rendered row height
  height={480}                 // scroll container height
  overscanCount={5}            // rows rendered above/below viewport
  renderItem={({ item, index, style }) => (
    <div style={style}>       // spread style onto outermost element
      <LeaderboardRow entry={item} />
    </div>
  )}
  onLoadMore={fetchNextPage}   // fired when <loadMoreThreshold px from bottom
  loadMoreThreshold={200}
  isLoadingMore={isFetching}
  emptyState={<EmptyState />}
/>
```

### `VirtualDynamicList<T>` — `src/components/ui/VirtualDynamicList.tsx`

Variable row height list using `ResizeObserver` to measure each row after it mounts. Best for match history where row content (tournament badges, multi-line opponents) varies in height.

```tsx
<VirtualDynamicList
  listId="match-history"
  items={matches}
  estimatedItemSize={88}       // initial guess — refined by measurement
  height={560}
  renderItem={({ item, index, style, measureRef }) => (
    <div style={style}>
      <div ref={measureRef}>   // attach measureRef to the content wrapper
        <MatchRow match={item} />
      </div>
    </div>
  )}
  onLoadMore={fetchMoreMatches}
/>
```

### `VirtualGrid<T>` — `src/components/ui/VirtualGrid.tsx`

Responsive fixed-size grid. Column count is computed automatically from a `ResizeObserver` on the container, replicating the `grid-cols-auto-fill` CSS pattern. Best for tournament cards.

```tsx
<VirtualGrid
  listId="tournament-list"
  items={tournaments}
  columnMinWidth={300}         // min px per column; actual count = floor((containerW + gap) / (minW + gap))
  rowHeight={340}              // px per row
  height={720}
  gap={24}
  renderItem={({ item, style }) => (
    <div style={style}>
      <TournamentCard tournament={item} />
    </div>
  )}
  onLoadMore={fetchNextPage}
/>
```

---

## Virtualisation thresholds

Each list component switches between a plain DOM render and a virtual render based on item count. Below the threshold the overhead of react-window is unnecessary.

| List | Threshold | Why |
|---|---|---|
| `LeaderboardTable` | Always virtual | Data comes from API with offset/limit; always large |
| `MatchHistory` | ≥ 20 items | Below 20 the static `space-y-3` list is imperceptibly fast |
| `TournamentList` | ≥ 12 items | One full grid page; below this a static 3-col grid is fine |
| `FriendsList` | ≥ 30 friends | Most users have fewer; virtualise for power users |

---

## Infinite scroll integration

All four virtualised components accept:

```ts
onLoadMore?: () => void       // fired once when scrollOffset nears the bottom
isLoadingMore?: boolean       // shows a spinner below the list while loading
loadMoreThreshold?: number    // px from bottom to trigger (default 200–400)
```

Wire them to `useInfiniteScroll` (already exists at `src/hooks/useInfiniteScroll.ts`):

```tsx
const { items, loading, hasMore, sentinelRef } = useInfiniteScroll({
  fetchPage: async (cursor) => {
    const res = await api.getLeaderboard({ cursor, limit: 50 });
    return { items: res.entries, nextCursor: res.nextCursor };
  },
});

<LeaderboardTable
  entries={items}
  onLoadMore={() => {/* sentinel fires automatically via useInfiniteScroll */}}
  isLoadingMore={loading}
/>
```

---

## Analytics

Every virtual list emits structured events via `useVirtualScrollAnalytics` (`src/hooks/useVirtualScrollAnalytics.ts`):

| Event | When fired | Key fields |
|---|---|---|
| `virtual_list_mount` | After first render with items | `totalItems`, `visibleItems`, `renderMs` |
| `virtual_list_scroll` | Every 5% of scroll progress | `scrollPercent`, `visibleItems` |
| `virtual_list_load_more` | When `onLoadMore` triggers | `loadedItems`, `totalItems` |
| `virtual_list_item_click` | When a row is clicked | `itemIndex` |

In production events are sent to **Datadog RUM** via `window.DD_RUM.addAction`. In development they are printed to the console via `console.debug`.

---

## Performance considerations

- **`renderItem` stability** — Pass a stable (memoised) render function. If `renderItem` is defined inline it will recreate the react-window `Row` component on every parent re-render, causing all mounted rows to unmount and remount. Use `useCallback`.

- **`itemData` pattern** — `VirtualList` passes data through react-window's `itemData` prop rather than closure capture. This avoids the costly full re-render of all rows when any list prop changes.

- **`style` must be spread** — The `style` object from the render prop contains `position: absolute`, `top`, `height`, and `width`. It **must** be spread onto the outermost element of each row; omitting it breaks layout.

- **`measureRef` in VirtualDynamicList** — Attach to the inner content div, not the outer `style` element, so `ResizeObserver` measures the true rendered height and `resetAfterIndex` only invalidates rows that changed.

- **Dynamic rows and sort/filter** — `VirtualDynamicList` clears the height cache and calls `resetAfterIndex(0)` whenever `items` changes. Sorting or filtering produces a new array reference, so heights are always re-measured.

---

## Testing

Tests live at `src/__tests__/virtual-scrolling.test.tsx`.

react-window is mocked in tests to render all items directly (no viewport clipping), so assertions on item content work as expected. Only scroll-triggered behaviour (onLoadMore, analytics) is tested with simulated scroll events.

Run with:

```bash
npm test -- virtual-scrolling.test.tsx
```

---

## Adding virtual scrolling to a new list

1. Choose a primitive: `VirtualList` (fixed heights) or `VirtualDynamicList` (variable heights)
2. Decide on a threshold — add it as a constant at the top of the component
3. Add `listId`, `onLoadMore`, `isLoadingMore` props to the component's prop interface
4. Wrap the render function with `useCallback`
5. Add `useVirtualScrollAnalytics` if custom click tracking is needed
6. Write at least two tests: one for the static path and one for the virtual path
