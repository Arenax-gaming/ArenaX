/**
 * Tests for infinite scroll in <MatchHistory /> (#888).
 *
 * Covers: IntersectionObserver-triggered loading, duplicate prevention across
 * overlapping pages, the pending-gate that stops duplicate requests, batch
 * latency measurement, and the end-of-list marker.
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { MatchHistory } from "@/components/profile/MatchHistory";
import type { MatchWithPlayers } from "@/types/profile";

// ─── IntersectionObserver mock ────────────────────────────────────────────────
let ioInstances: MockIO[] = [];

class MockIO {
  callback: IntersectionObserverCallback;
  element: Element | null = null;
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    ioInstances.push(this);
  }
  observe = (el: Element) => {
    this.element = el;
  };
  unobserve = jest.fn();
  disconnect = jest.fn();
  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

const intersectLatest = () =>
  act(() => ioInstances[ioInstances.length - 1].trigger(true));

beforeEach(() => {
  ioInstances = [];
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    jest.fn((cb: IntersectionObserverCallback) => new MockIO(cb));
  // jsdom does not implement scrollTo; stub it so restoration is a no-op.
  window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
  // Run rAF synchronously so scroll restoration is observable in the test.
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as unknown as typeof window.requestAnimationFrame;
  window.sessionStorage.clear();
});

function makeMatches(count: number, offset = 0): MatchWithPlayers[] {
  return Array.from({ length: count }, (_, i) => {
    const n = i + offset;
    return {
      id: `match-${n}`,
      player1Id: "me",
      player2Id: `opp-${n}`,
      player1Username: "Me",
      player2Username: `Opponent${n}`,
      winnerId: n % 2 === 0 ? "me" : `opp-${n}`,
      gameType: "FPS",
      score: "3-1",
      date: new Date("2024-01-01T00:00:00Z").toISOString(),
    } as MatchWithPlayers;
  });
}

describe("MatchHistory — infinite scroll (#888)", () => {
  it("does not enable infinite scroll without onLoadMore (backward compatible)", () => {
    render(<MatchHistory matches={makeMatches(5)} currentUserId="me" />);
    expect(
      screen.queryByTestId("infinite-scroll-sentinel")
    ).not.toBeInTheDocument();
  });

  it("renders a sentinel and calls onLoadMore when it intersects", () => {
    const onLoadMore = jest.fn();
    render(
      <MatchHistory
        matches={makeMatches(10)}
        currentUserId="me"
        onLoadMore={onLoadMore}
      />
    );
    expect(screen.getByTestId("infinite-scroll-sentinel")).toBeInTheDocument();
    expect(onLoadMore).not.toHaveBeenCalled();
    intersectLatest();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not fire again while a load is pending (duplicate request prevention)", () => {
    const onLoadMore = jest.fn();
    render(
      <MatchHistory
        matches={makeMatches(10)}
        currentUserId="me"
        onLoadMore={onLoadMore}
        isLoadingMore
      />
    );
    // isLoadingMore is true → the observer must not trigger a load.
    intersectLatest();
    intersectLatest();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("re-arms once a new batch arrives", () => {
    const onLoadMore = jest.fn();
    const { rerender } = render(
      <MatchHistory
        matches={makeMatches(10)}
        currentUserId="me"
        onLoadMore={onLoadMore}
      />
    );
    intersectLatest();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    // A second intersection before new data must be ignored (pending gate).
    intersectLatest();
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    // Parent appends the next page → gate releases.
    rerender(
      <MatchHistory
        matches={makeMatches(20)}
        currentUserId="me"
        onLoadMore={onLoadMore}
      />
    );
    intersectLatest();
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates overlapping matches across pages", () => {
    // Page 1: match-0..9, Page 2 overlaps with match-5..14.
    const overlapping = [...makeMatches(10), ...makeMatches(10, 5)];
    render(
      <MatchHistory
        matches={overlapping}
        currentUserId="me"
        onLoadMore={jest.fn()}
      />
    );
    // 15 unique opponents, not 20 — Opponent7 must render exactly once.
    expect(screen.getAllByText("vs Opponent7")).toHaveLength(1);
    expect(screen.getAllByText(/vs Opponent/)).toHaveLength(15);
  });

  it("reports batch latency and shows the end marker when exhausted", () => {
    const onBatchLoad = jest.fn();
    const { rerender } = render(
      <MatchHistory
        matches={makeMatches(10)}
        currentUserId="me"
        onLoadMore={jest.fn()}
        onBatchLoad={onBatchLoad}
      />
    );
    intersectLatest();
    // New batch arrives → latency reported once.
    rerender(
      <MatchHistory
        matches={makeMatches(20)}
        currentUserId="me"
        onLoadMore={jest.fn()}
        onBatchLoad={onBatchLoad}
        hasMore={false}
      />
    );
    expect(onBatchLoad).toHaveBeenCalledTimes(1);
    expect(typeof onBatchLoad.mock.calls[0][0]).toBe("number");
    // hasMore=false → sentinel gone, end marker shown.
    expect(
      screen.queryByTestId("infinite-scroll-sentinel")
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/reached the end of your match history/i)
    ).toBeInTheDocument();
  });

  it("restores the saved scroll position on mount", () => {
    window.sessionStorage.setItem("mh-scroll:match-history", "640");
    render(
      <MatchHistory
        matches={makeMatches(10)}
        currentUserId="me"
        onLoadMore={jest.fn()}
      />
    );
    expect(window.scrollTo).toHaveBeenCalledWith(0, 640);
  });
});
