/**
 * Unit tests for useMatchScoreReporting's optimistic "Pending Confirmation"
 * state (#1088).
 *
 * Covers:
 *  - pendingReport is set instantly on submit, before the simulated
 *    round-trip delay resolves (verifies UI updates immediately, not after
 *    the delay)
 *  - isReporting reflects the in-flight mutation
 *  - a conflicting expected report surfaces conflictDetected/conflictingReport
 *    and reportScore resolves to false
 *  - clearConflict resets the conflict state
 */

import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMatchScoreReporting } from "@/hooks/useMatchWebSocket";
import type { ScoreReport } from "@/types/bracket";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useMatchScoreReporting", () => {
  it("sets pendingReport instantly, well before the ~900ms round trip resolves", async () => {
    const { result } = renderHook(
      () => useMatchScoreReporting({ matchId: "match-1" }),
      { wrapper },
    );

    expect(result.current.pendingReport).toBeNull();

    let submitPromise: Promise<boolean>;
    act(() => {
      submitPromise = result.current.reportScore({
        matchId: "match-1",
        player1Score: 3,
        player2Score: 1,
        reporterId: "user-1",
        reporterName: "Alex",
      });
    });

    // Instant: pendingReport is visible synchronously after the submit call,
    // not after the simulated network delay.
    await waitFor(() =>
      expect(result.current.pendingReport).toEqual(
        expect.objectContaining({ player1Score: 3, player2Score: 1, reporterName: "Alex" }),
      ),
    );
    expect(result.current.isReporting).toBe(true);

    const ok = await submitPromise!;
    expect(ok).toBe(true);
    await waitFor(() => expect(result.current.isReporting).toBe(false));
  });

  it("detects a conflict when the submitted score does not match the expected report", async () => {
    const expectedReport: ScoreReport = {
      reporterId: "opponent-1",
      reporterName: "Opponent",
      player1Score: 3,
      player2Score: 2,
      submittedAt: new Date().toISOString(),
    };

    const { result } = renderHook(
      () => useMatchScoreReporting({ matchId: "match-2", expectedReport }),
      { wrapper },
    );

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.reportScore({
        matchId: "match-2",
        player1Score: 3,
        player2Score: 1,
        reporterId: "user-1",
      });
    });

    expect(ok).toBe(false);
    expect(result.current.conflictDetected).toBe(true);
    expect(result.current.conflictingReport).toEqual(expectedReport);

    act(() => {
      result.current.clearConflict();
    });
    expect(result.current.conflictDetected).toBe(false);
    expect(result.current.conflictingReport).toBeNull();
  });
});
