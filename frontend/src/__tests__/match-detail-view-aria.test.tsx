/**
 * Unit tests for ARIA live region announcements in MatchDetailView (#1087).
 *
 * next-intl is mocked (as done elsewhere in this suite, e.g.
 * error-boundaries.test.tsx) to avoid needing a full intl provider; the
 * mock returns `key:{"param":"value"}` so assertions can check both the
 * translation key used and the interpolated values.
 */

import React from "react";
import { render, screen, act } from "@testing-library/react";
import { MatchDetailView } from "@/components/match/MatchDetailView";
import type { MatchDetail } from "@/types/match";

jest.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

/**
 * Advances past both the debounce window under test and AriaLiveRegion's
 * own internal 50ms clear-then-set delay (it re-announces by clearing and
 * re-setting the text, so screen readers announce repeat values too).
 */
function advanceAndFlush(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
  act(() => {
    jest.advanceTimersByTime(60);
  });
}

function baseMatch(overrides: Partial<MatchDetail> = {}): MatchDetail {
  return {
    id: "m1",
    player1Id: "p1",
    player2Id: "p2",
    player1Username: "Alpha",
    player2Username: "Bravo",
    gameType: "arena",
    status: "in_progress",
    scorePlayer1: 0,
    scorePlayer2: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("MatchDetailView — ARIA live announcements (#1087)", () => {
  it("does not announce anything on initial mount", () => {
    render(<MatchDetailView match={baseMatch()} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.getByRole("alert")).toHaveTextContent("");
  });

  it("announces a score update politely, debounced by 500ms", () => {
    const { rerender } = render(<MatchDetailView match={baseMatch()} />);

    rerender(<MatchDetailView match={baseMatch({ scorePlayer1: 1 })} />);

    // Not yet announced — still within the debounce window.
    expect(screen.getByRole("status")).toHaveTextContent("");

    advanceAndFlush(500);

    expect(screen.getByRole("status").textContent).toContain("scoreUpdated");
    expect(screen.getByRole("status").textContent).toContain('"scoreA":1');
  });

  it("coalesces rapid consecutive score updates into a single announcement", () => {
    const { rerender } = render(<MatchDetailView match={baseMatch()} />);

    rerender(<MatchDetailView match={baseMatch({ scorePlayer1: 1 })} />);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    rerender(<MatchDetailView match={baseMatch({ scorePlayer1: 2 })} />);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    rerender(<MatchDetailView match={baseMatch({ scorePlayer1: 3 })} />);

    // Still coalescing — no announcement yet even though 400ms has elapsed
    // in total, because each update restarted the 500ms window.
    expect(screen.getByRole("status")).toHaveTextContent("");

    advanceAndFlush(500);

    // Only the final, coalesced value is announced.
    expect(screen.getByRole("status").textContent).toContain('"scoreA":3');
  });

  it("announces match completion assertively with the winner and final score", () => {
    const { rerender } = render(<MatchDetailView match={baseMatch()} />);

    rerender(
      <MatchDetailView
        match={baseMatch({
          status: "completed",
          winnerId: "p1",
          scorePlayer1: 3,
          scorePlayer2: 1,
        })}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(60);
    });

    const alert = screen.getByRole("alert").textContent!;
    expect(alert).toContain("completed");
    expect(alert).toContain('"winner":"Alpha"');
    expect(alert).toContain('"scoreA":3');
    expect(alert).toContain('"scoreB":1');
  });

  it("announces a dispute assertively", () => {
    const { rerender } = render(<MatchDetailView match={baseMatch()} />);

    rerender(<MatchDetailView match={baseMatch({ status: "disputed" })} />);
    act(() => {
      jest.advanceTimersByTime(60);
    });

    expect(screen.getByRole("alert").textContent).toContain("disputed");
  });

  it("does not re-announce the same status transition twice", () => {
    const { rerender } = render(<MatchDetailView match={baseMatch()} />);

    rerender(<MatchDetailView match={baseMatch({ status: "disputed" })} />);
    act(() => {
      jest.advanceTimersByTime(60);
    });
    const firstAnnouncement = screen.getByRole("alert").textContent;

    // Re-render with the exact same status again (e.g. an unrelated prop
    // update) — must not produce a second announcement.
    rerender(<MatchDetailView match={baseMatch({ status: "disputed", replayUrl: "" })} />);
    act(() => {
      jest.advanceTimersByTime(60);
    });

    expect(screen.getByRole("alert").textContent).toBe(firstAnnouncement);
  });
});
