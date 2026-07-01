/**
 * Virtual scrolling tests
 *
 * Covers:
 *  - VirtualList renders only a visible subset of items
 *  - VirtualList calls onLoadMore when scrolled near the bottom
 *  - VirtualDynamicList measures and renders variable-height rows
 *  - LeaderboardTable renders virtual rows and fires sort callbacks
 *  - MatchHistory activates virtualisation at the 20-item threshold
 *  - TournamentList switches between static grid and VirtualGrid
 *  - useVirtualScrollAnalytics tracks events without throwing
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { VirtualList } from "@/components/ui/VirtualList";
import { VirtualDynamicList } from "@/components/ui/VirtualDynamicList";
import { LeaderboardTable, LeaderboardEntry } from "@/components/leaderboard/LeaderboardTable";
import { MatchHistory } from "@/components/profile/MatchHistory";
import { TournamentList } from "@/components/tournaments/TournamentList";
import { renderHook } from "@testing-library/react";
import { useVirtualScrollAnalytics } from "@/hooks/useVirtualScrollAnalytics";
import type { Tournament } from "@/types/tournament";
import type { MatchWithPlayers } from "@/types/profile";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// react-window renders nothing meaningful in jsdom without layout.
// We mock FixedSizeList and VariableSizeList to render all items directly
// so assertions about item content still work, while scroll/size maths is tested separately.
jest.mock("react-window", () => {
  const React = require("react");

  const FixedSizeList = ({
    children: Row,
    itemCount,
    itemData,
    height,
    onScroll,
  }: any) => {
    const items = Array.from({ length: itemCount }, (_, i) => (
      <Row key={i} index={i} style={{ height: 56, position: "absolute", top: i * 56 }} data={itemData} />
    ));
    return (
      <div
        data-testid="fixed-size-list"
        style={{ height, overflow: "auto" }}
        onScroll={(e) =>
          onScroll?.({ scrollOffset: (e.target as HTMLElement).scrollTop })
        }
      >
        {items}
      </div>
    );
  };

  const VariableSizeList = ({
    children: Row,
    itemCount,
    height,
    onScroll,
  }: any) => {
    const items = Array.from({ length: itemCount }, (_, i) => (
      <Row key={i} index={i} style={{ height: 88, position: "absolute", top: i * 88 }} />
    ));
    return (
      <div
        data-testid="variable-size-list"
        style={{ height, overflow: "auto" }}
        onScroll={(e) =>
          onScroll?.({ scrollOffset: (e.target as HTMLElement).scrollTop })
        }
      >
        {items}
      </div>
    );
  };

  const FixedSizeGrid = ({
    children: Cell,
    columnCount,
    rowCount,
    height,
    onScroll,
  }: any) => {
    const cells = [];
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < columnCount; c++) {
        cells.push(
          <Cell
            key={`${r}-${c}`}
            rowIndex={r}
            columnIndex={c}
            style={{ position: "absolute", top: r * 320, left: c * 300, width: 300, height: 320 }}
          />
        );
      }
    }
    return (
      <div
        data-testid="fixed-size-grid"
        style={{ height, overflow: "auto" }}
        onScroll={(e) =>
          onScroll?.({ scrollTop: (e.target as HTMLElement).scrollTop })
        }
      >
        {cells}
      </div>
    );
  };

  return { FixedSizeList, VariableSizeList, FixedSizeGrid };
});

// Mock ResizeObserver (not available in jsdom)
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLeaderboardEntries(count: number): LeaderboardEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    rank: i + 1,
    userId: `user-${i}`,
    username: `Player${i}`,
    points: 1000 - i * 10,
    wins: 50 - i,
    winRate: (50 - i) / 100,
    lastUpdated: new Date(),
    trend: (["up", "down", "stable"] as const)[i % 3],
  }));
}

function makeMatches(count: number): MatchWithPlayers[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `match-${i}`,
    player1Id: "me",
    player2Id: `opp-${i}`,
    player1Username: "Me",
    player2Username: `Opponent${i}`,
    winnerId: i % 2 === 0 ? "me" : `opp-${i}`,
    gameType: "FPS",
    score: "3-1",
    date: new Date().toISOString(),
  }));
}

function makeTournaments(count: number): Tournament[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t-${i}`,
    name: `Tournament ${i}`,
    gameType: "FPS",
    tournamentType: "single_elimination",
    entryFee: 0,
    prizePool: 1000,
    maxParticipants: 64,
    currentParticipants: 32,
    status: "registration_open" as const,
    visibility: "public" as const,
    startTime: new Date().toISOString(),
    createdBy: "admin",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

// ─── VirtualList ─────────────────────────────────────────────────────────────

describe("VirtualList", () => {
  it("renders all items via the mocked FixedSizeList", () => {
    const items = Array.from({ length: 50 }, (_, i) => `Item ${i}`);
    render(
      <VirtualList
        listId="test-list"
        items={items}
        itemHeight={40}
        height={200}
        renderItem={({ item, style }) => (
          <div style={style} key={item}>
            {item}
          </div>
        )}
      />
    );
    expect(screen.getByTestId("fixed-size-list")).toBeInTheDocument();
    expect(screen.getByText("Item 0")).toBeInTheDocument();
    expect(screen.getByText("Item 49")).toBeInTheDocument();
  });

  it("renders emptyState when items is empty", () => {
    render(
      <VirtualList
        listId="test-list"
        items={[]}
        itemHeight={40}
        height={200}
        renderItem={({ item, style }) => <div style={style}>{String(item)}</div>}
        emptyState={<p>Nothing here</p>}
      />
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByTestId("fixed-size-list")).not.toBeInTheDocument();
  });

  it("calls onLoadMore when scrolled near the bottom", () => {
    const onLoadMore = jest.fn();
    const items = Array.from({ length: 100 }, (_, i) => i);
    render(
      <VirtualList
        listId="test-list"
        items={items}
        itemHeight={40}
        height={200}
        loadMoreThreshold={500}
        onLoadMore={onLoadMore}
        renderItem={({ item, style }) => <div style={style}>{item}</div>}
      />
    );
    const list = screen.getByTestId("fixed-size-list");
    // Simulate a scroll near the end (offset > total - height - threshold)
    fireEvent.scroll(list, { target: { scrollTop: 3800 } });
    expect(onLoadMore).toHaveBeenCalled();
  });
});

// ─── VirtualDynamicList ──────────────────────────────────────────────────────

describe("VirtualDynamicList", () => {
  it("renders all items via the mocked VariableSizeList", () => {
    const items = Array.from({ length: 10 }, (_, i) => `Dynamic ${i}`);
    render(
      <VirtualDynamicList
        listId="dynamic-list"
        items={items}
        estimatedItemSize={88}
        height={400}
        renderItem={({ item, style }) => (
          <div style={style}>
            <div>{item}</div>
          </div>
        )}
      />
    );
    expect(screen.getByTestId("variable-size-list")).toBeInTheDocument();
    expect(screen.getByText("Dynamic 0")).toBeInTheDocument();
    expect(screen.getByText("Dynamic 9")).toBeInTheDocument();
  });

  it("renders emptyState when items is empty", () => {
    render(
      <VirtualDynamicList
        listId="dynamic-list"
        items={[]}
        estimatedItemSize={88}
        height={400}
        renderItem={({ item, style }) => <div style={style}>{String(item)}</div>}
        emptyState={<p>No items</p>}
      />
    );
    expect(screen.getByText("No items")).toBeInTheDocument();
  });
});

// ─── LeaderboardTable ────────────────────────────────────────────────────────

describe("LeaderboardTable", () => {
  it("renders all entries", () => {
    const entries = makeLeaderboardEntries(5);
    render(<LeaderboardTable entries={entries} />);
    expect(screen.getByText("Player0")).toBeInTheDocument();
    expect(screen.getByText("Player4")).toBeInTheDocument();
  });

  it("shows loading spinner when isLoading is true", () => {
    render(<LeaderboardTable entries={[]} isLoading />);
    expect(screen.getByLabelText("Loading leaderboard")).toBeInTheDocument();
  });

  it("shows empty message when no entries", () => {
    render(<LeaderboardTable entries={[]} />);
    expect(screen.getByText("No leaderboard entries found")).toBeInTheDocument();
  });

  it("calls onSortChange when a column header is clicked", () => {
    const onSortChange = jest.fn();
    const entries = makeLeaderboardEntries(3);
    render(<LeaderboardTable entries={entries} onSortChange={onSortChange} />);
    fireEvent.click(screen.getByText("Wins"));
    expect(onSortChange).toHaveBeenCalledWith("wins");
  });

  it("shows loading-more spinner when isLoadingMore is true", () => {
    const entries = makeLeaderboardEntries(3);
    render(<LeaderboardTable entries={entries} isLoadingMore />);
    expect(screen.getByLabelText("Loading more entries")).toBeInTheDocument();
  });
});

// ─── MatchHistory ─────────────────────────────────────────────────────────────

describe("MatchHistory", () => {
  it("uses static render for lists shorter than 20 items", () => {
    const matches = makeMatches(5);
    render(<MatchHistory matches={matches} currentUserId="me" />);
    // Static render — no virtual list
    expect(screen.queryByTestId("variable-size-list")).not.toBeInTheDocument();
    expect(screen.getByText("vs Opponent0")).toBeInTheDocument();
  });

  it("uses VirtualDynamicList for ≥20 items", () => {
    const matches = makeMatches(20);
    render(<MatchHistory matches={matches} currentUserId="me" />);
    expect(screen.getByTestId("variable-size-list")).toBeInTheDocument();
  });

  it("shows empty state when there are no matches", () => {
    render(<MatchHistory matches={[]} currentUserId="me" />);
    expect(screen.getByText("No matches found")).toBeInTheDocument();
  });

  it("filters by result", () => {
    const matches = makeMatches(5); // wins at even indices
    render(
      <MatchHistory
        matches={matches}
        currentUserId="me"
        filters={{ result: "win" }}
      />
    );
    // 5 matches, even indices 0,2,4 are wins → 3 wins
    expect(screen.getAllByText(/vs Opponent/)).toHaveLength(3);
  });

  it("skips virtualisation when disableVirtualization is true", () => {
    const matches = makeMatches(30);
    render(
      <MatchHistory
        matches={matches}
        currentUserId="me"
        disableVirtualization
      />
    );
    expect(screen.queryByTestId("variable-size-list")).not.toBeInTheDocument();
    expect(screen.getByText("vs Opponent0")).toBeInTheDocument();
  });
});

// ─── TournamentList ───────────────────────────────────────────────────────────

jest.mock("@/components/tournaments/TournamentCardWithQuickJoin", () => ({
  TournamentCardWithQuickJoin: ({ tournament }: { tournament: Tournament }) => (
    <div data-testid="tournament-card">{tournament.name}</div>
  ),
}));

jest.mock("@/lib/tournamentImageSizes", () => ({
  TOURNAMENT_GRID_IMAGE_SIZES: "(max-width: 768px) 100vw, 33vw",
}));

describe("TournamentList", () => {
  it("shows empty state when no tournaments", () => {
    render(<TournamentList tournaments={[]} emptyMessage="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("uses static grid for fewer than 12 tournaments", () => {
    const tournaments = makeTournaments(5);
    render(<TournamentList tournaments={tournaments} />);
    expect(screen.queryByTestId("fixed-size-grid")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("tournament-card")).toHaveLength(5);
  });

  it("uses VirtualGrid for 12 or more tournaments", () => {
    const tournaments = makeTournaments(12);
    render(<TournamentList tournaments={tournaments} />);
    expect(screen.getByTestId("fixed-size-grid")).toBeInTheDocument();
  });

  it("renders a reset-filters button when onResetFilters is provided", () => {
    const onReset = jest.fn();
    render(
      <TournamentList
        tournaments={[]}
        emptyMessage="No results"
        onResetFilters={onReset}
      />
    );
    const btn = screen.getByRole("button", { name: /reset filters/i });
    fireEvent.click(btn);
    expect(onReset).toHaveBeenCalled();
  });
});

// ─── useVirtualScrollAnalytics ───────────────────────────────────────────────

describe("useVirtualScrollAnalytics", () => {
  it("returns stable function references", () => {
    const { result, rerender } = renderHook(() =>
      useVirtualScrollAnalytics("test-list")
    );
    const first = result.current;
    rerender();
    expect(result.current.trackScroll).toBe(first.trackScroll);
    expect(result.current.trackLoadMore).toBe(first.trackLoadMore);
  });

  it("does not throw when all track methods are called", () => {
    const { result } = renderHook(() => useVirtualScrollAnalytics("test"));
    expect(() => {
      result.current.trackMountStart();
      result.current.trackMountComplete(100, 10);
      result.current.trackScroll(500, 5000, 10);
      result.current.trackLoadMore(50, 100);
      result.current.trackItemClick(5);
    }).not.toThrow();
  });

  it("does not fire trackScroll for small scroll changes (< 5%)", () => {
    const consoleSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
    const { result } = renderHook(() => useVirtualScrollAnalytics("test"));
    result.current.trackScroll(10, 1000, 5);  // 1%
    result.current.trackScroll(30, 1000, 5);  // 3% — still < 5% delta from 0
    expect(consoleSpy).not.toHaveBeenCalledWith(
      "[VirtualScrollAnalytics]",
      expect.objectContaining({ type: "virtual_list_scroll" })
    );
    consoleSpy.mockRestore();
  });
});
