/**
 * Tests for React Query prefetching on hover/focus for tournament cards —
 * Issue #1099.
 *
 * Covers:
 *  - hovering a card schedules a debounced prefetchQuery with the right key
 *  - leaving the card before the debounce window cancels the prefetch
 *  - touchstart triggers the same prefetch path on touch devices
 *  - the global 3-request concurrency cap cancels the oldest prefetch
 */

import React from "react";
import { fireEvent, render } from "@testing-library/react";
import { TournamentCard } from "@/components/tournaments/TournamentCard";
import { Tournament } from "@/types/tournament";
import { resetTournamentPrefetchRegistry } from "@/hooks/useTournamentPrefetch";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const prefetchMock = jest.fn();
const cancelQueriesMock = jest.fn();

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    prefetchQuery: prefetchMock,
    cancelQueries: cancelQueriesMock,
  }),
}));

jest.mock("@/data/apiClient", () => ({
  apiClient: {
    getEnveloped: jest.fn(() => Promise.resolve({})),
  },
}));

const baseTournament: Tournament = {
  id: "t1",
  name: "ArenaX Showdown",
  description: "A public tournament",
  gameType: "Battle Arena",
  tournamentType: "single_elimination",
  entryFee: 10,
  prizePool: 500,
  maxParticipants: 16,
  currentParticipants: 8,
  status: "registration_open",
  visibility: "public",
  startTime: new Date().toISOString(),
  endTime: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
  createdBy: "org-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeCard(id = baseTournament.id) {
  return render(<TournamentCard tournament={{ ...baseTournament, id }} />).container;
}

describe("TournamentCard prefetch on hover", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    prefetchMock.mockReset();
    prefetchMock.mockResolvedValue({});
    cancelQueriesMock.mockClear();
    resetTournamentPrefetchRegistry();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("prefers not to prefetch until the 150ms debounce elapses", () => {
    makeCard();
    const card = document.querySelector(".rounded-lg");

    fireEvent.mouseEnter(card as Element);
    jest.advanceTimersByTime(50);

    expect(prefetchMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(prefetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls prefetchQuery with the tournament detail key and 30s staleTime", () => {
    makeCard();
    const card = document.querySelector(".rounded-lg");

    fireEvent.mouseEnter(card as Element);
    jest.advanceTimersByTime(200);

    expect(prefetchMock).toHaveBeenCalledWith({
      queryKey: ["tournaments", "t1"],
      queryFn: expect.any(Function),
      staleTime: 30_000,
    });
  });

  it("does not prefetch when the pointer leaves before the debounce window", () => {
    makeCard();
    const card = document.querySelector(".rounded-lg");

    fireEvent.mouseEnter(card as Element);
    fireEvent.mouseLeave(card as Element);
    jest.advanceTimersByTime(300);

    expect(prefetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates rapid re-entries — only a single prefetch for the same card", () => {
    makeCard();
    const card = document.querySelector(".rounded-lg");

    fireEvent.mouseEnter(card as Element);
    fireEvent.mouseLeave(card as Element);
    jest.advanceTimersByTime(100);
    fireEvent.mouseEnter(card as Element);
    jest.advanceTimersByTime(200);

    expect(prefetchMock).toHaveBeenCalledTimes(1);
  });

  it("prefetches on touchstart for touch devices", () => {
    makeCard();
    const card = document.querySelector(".rounded-lg");

    fireEvent.touchStart(card as Element);
    jest.advanceTimersByTime(200);

    expect(prefetchMock).toHaveBeenCalledTimes(1);
    expect(prefetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["tournaments", "t1"] }),
    );
  });

  it("limits concurrent prefetches to 3 and cancels the oldest", () => {
    // Keep prefetches in-flight so the registry stays populated.
    prefetchMock.mockReturnValue(new Promise(() => {}));

    const containers = ["t1", "t2", "t3", "t4"].map((id) => makeCard(id));
    containers.forEach((container) => {
      fireEvent.mouseEnter(container.querySelector(".rounded-lg") as Element);
    });
    jest.advanceTimersByTime(400);

    expect(prefetchMock).toHaveBeenCalledTimes(4);
    // The 4th prefetch exceeds the cap and must cancel the oldest (t1).
    expect(cancelQueriesMock).toHaveBeenCalledWith({
      queryKey: ["tournaments", "t1"],
    });
  });
});