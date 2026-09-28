/**
 * Unit tests for EloChart's date-range and game filters (#1096).
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EloChart } from "@/components/profile/EloChart";

const mockGetEloHistory = jest.fn();
jest.mock("@/lib/api", () => ({
  api: {
    getEloHistory: (...args: unknown[]) => mockGetEloHistory(...args),
  },
}));

// recharts' ResponsiveContainer needs real layout (width/height) to render
// its children in jsdom; stub it out so the chart body renders unconditionally.
jest.mock("recharts", () => {
  const actual = jest.requireActual("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 800, height: 300 }}>{children}</div>
    ),
  };
});

function renderChart(games: string[] = ["chess", "checkers"]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EloChart games={games} defaultGame="chess" />
    </QueryClientProvider>,
  );
}

describe("EloChart", () => {
  beforeEach(() => {
    mockGetEloHistory.mockReset();
    mockGetEloHistory.mockResolvedValue([
      { date: "2026-01-01", elo: 1200 },
      { date: "2026-01-08", elo: 1250 },
    ]);
  });

  it("fetches the default game with a 30-day range on mount", async () => {
    renderChart();

    await waitFor(() => expect(mockGetEloHistory).toHaveBeenCalled());
    const [game, from, to] = mockGetEloHistory.mock.calls[0];
    expect(game).toBe("chess");
    expect(from).toEqual(expect.any(String));
    expect(to).toEqual(expect.any(String));

    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(toMs - fromMs).toBeCloseTo(thirtyDaysMs, -3);
  });

  it("re-fetches with new from/to params when the date range changes", async () => {
    renderChart();
    await waitFor(() => expect(mockGetEloHistory).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));

    await waitFor(() => expect(mockGetEloHistory).toHaveBeenCalledTimes(2));
    const [game, from, to] = mockGetEloHistory.mock.calls[1];
    expect(game).toBe("chess");

    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(toMs - fromMs).toBeCloseTo(sevenDaysMs, -3);
  });

  it("re-fetches for the newly selected game when the game filter changes", async () => {
    renderChart();
    await waitFor(() => expect(mockGetEloHistory).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Filter by game"), {
      target: { value: "checkers" },
    });

    await waitFor(() => expect(mockGetEloHistory).toHaveBeenCalledTimes(2));
    expect(mockGetEloHistory.mock.calls[1][0]).toBe("checkers");
  });

  it("defaults to the 30-day range button being active", () => {
    renderChart();
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
