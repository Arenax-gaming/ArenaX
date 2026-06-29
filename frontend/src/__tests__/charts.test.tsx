/**
 * Tests for chart component library (issue #522)
 *
 * Recharts renders SVG in a jsdom environment, so we mock ResponsiveContainer
 * to render children immediately (avoids ResizeObserver issues in jsdom).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { ChartCard } from "@/components/charts/ChartCard";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { PlayerStatsCharts, PlayerStatsData } from "@/components/charts/PlayerStatsCharts";
import { AnalyticsDashboard, AnalyticsData } from "@/components/charts/AnalyticsDashboard";
import { TournamentResultsCharts, TournamentResultsData } from "@/components/charts/TournamentResultsCharts";

/* ── Recharts mocks ─────────────────────────────────────────────────────── */

jest.mock("recharts", () => {
  const Original = jest.requireActual("recharts");
  return {
    ...Original,
    // Render children immediately without needing a real ResizeObserver
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 500, height: 300 }}>
        {children}
      </div>
    ),
  };
});

/* ── ChartCard ──────────────────────────────────────────────────────────── */

describe("ChartCard", () => {
  it("renders title and children", () => {
    render(
      <ChartCard title="Test Chart">
        <span data-testid="child">content</span>
      </ChartCard>
    );
    expect(screen.getByText("Test Chart")).toBeInTheDocument();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders optional description", () => {
    render(
      <ChartCard title="T" description="Some description">
        <span />
      </ChartCard>
    );
    expect(screen.getByText("Some description")).toBeInTheDocument();
  });

  it("omits aria-describedby when no description provided", () => {
    render(
      <ChartCard title="T">
        <span />
      </ChartCard>
    );
    const card = screen.getByText("T").closest('[aria-describedby]');
    expect(card).toBeNull();
  });

  it("uses custom height", () => {
    const { container } = render(
      <ChartCard title="T" height={400}>
        <span />
      </ChartCard>
    );
    const inner = container.querySelector('[style*="height: 400px"], [style*="height:400px"]');
    expect(inner).toBeInTheDocument();
  });
});

/* ── ChartTooltip ───────────────────────────────────────────────────────── */

describe("ChartTooltip", () => {
  it("renders nothing when not active", () => {
    const { container } = render(
      <ChartTooltip active={false} payload={[]} label="Jan" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when payload is empty", () => {
    const { container } = render(
      <ChartTooltip active payload={[]} label="Jan" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders label and values when active", () => {
    const payload = [{ name: "kills", value: 15, color: "#00f" }] as any;
    render(<ChartTooltip active payload={payload} label="Match 3" />);
    expect(screen.getByText("Match 3")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
  });

  it("applies custom formatter", () => {
    const payload = [{ name: "revenue", value: 5000, color: "#0f0" }] as any;
    render(
      <ChartTooltip
        active
        payload={payload}
        label="Jan"
        formatter={(v) => `₦${Number(v).toLocaleString()}`}
      />
    );
    expect(screen.getByText("₦5,000")).toBeInTheDocument();
  });

  it("has role=tooltip for accessibility", () => {
    const payload = [{ name: "n", value: 1, color: "#f00" }] as any;
    render(<ChartTooltip active payload={payload} label="x" />);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});

/* ── PlayerStatsCharts ──────────────────────────────────────────────────── */

const playerStatsData: PlayerStatsData = {
  wins: 70,
  losses: 30,
  kdaHistory: [
    { date: "W1", kills: 12, deaths: 5, assists: 8 },
    { date: "W2", kills: 15, deaths: 3, assists: 10 },
  ],
  xpHistory: [
    { date: "W1", xp: 500 },
    { date: "W2", xp: 1200 },
  ],
};

describe("PlayerStatsCharts", () => {
  it("renders section with accessible label", () => {
    render(<PlayerStatsCharts stats={playerStatsData} />);
    expect(
      screen.getByRole("region", { name: "Player Performance Charts" })
    ).toBeInTheDocument();
  });

  it("renders Win/Loss chart title", () => {
    render(<PlayerStatsCharts stats={playerStatsData} />);
    expect(screen.getByText("Win / Loss Ratio")).toBeInTheDocument();
  });

  it("renders KDA chart title", () => {
    render(<PlayerStatsCharts stats={playerStatsData} />);
    expect(screen.getByText("KDA Over Time")).toBeInTheDocument();
  });

  it("renders XP Progression chart title", () => {
    render(<PlayerStatsCharts stats={playerStatsData} />);
    expect(screen.getByText("XP Progression")).toBeInTheDocument();
  });

  it("includes win/loss stats in description", () => {
    render(<PlayerStatsCharts stats={playerStatsData} />);
    expect(screen.getByText(/70 wins and 30 losses/)).toBeInTheDocument();
  });
});

/* ── AnalyticsDashboard ─────────────────────────────────────────────────── */

const analyticsData: AnalyticsData = {
  dauHistory: [
    { date: "Mon", users: 120 },
    { date: "Tue", users: 200 },
  ],
  revenueHistory: [
    { date: "Jan", revenue: 50000 },
    { date: "Feb", revenue: 80000 },
  ],
  matchOutcomes: [
    { date: "W1", wins: 60, losses: 30, draws: 10 },
  ],
};

describe("AnalyticsDashboard", () => {
  it("renders accessible region", () => {
    render(<AnalyticsDashboard data={analyticsData} />);
    expect(
      screen.getByRole("region", { name: "Platform Analytics Dashboard" })
    ).toBeInTheDocument();
  });

  it("renders all three chart titles", () => {
    render(<AnalyticsDashboard data={analyticsData} />);
    expect(screen.getByText("Daily Active Users")).toBeInTheDocument();
    expect(screen.getByText("Revenue Over Time")).toBeInTheDocument();
    expect(screen.getByText("Match Outcomes")).toBeInTheDocument();
  });
});

/* ── TournamentResultsCharts ────────────────────────────────────────────── */

const tournamentData: TournamentResultsData = {
  placements: [
    { placement: "1st", players: 1 },
    { placement: "2nd", players: 1 },
    { placement: "Top 4", players: 2 },
  ],
  prizeBreakdown: [
    { label: "1st Place", amount: 50000 },
    { label: "2nd Place", amount: 25000 },
  ],
  roundProgression: [
    { round: "R1", PlayerA: 10, PlayerB: 8 },
    { round: "R2", PlayerA: 20, PlayerB: 18 },
  ],
  players: ["PlayerA", "PlayerB"],
};

describe("TournamentResultsCharts", () => {
  it("renders accessible region", () => {
    render(<TournamentResultsCharts data={tournamentData} />);
    expect(
      screen.getByRole("region", { name: "Tournament Results Charts" })
    ).toBeInTheDocument();
  });

  it("renders all three chart titles", () => {
    render(<TournamentResultsCharts data={tournamentData} />);
    expect(screen.getByText("Placement Distribution")).toBeInTheDocument();
    expect(screen.getByText("Prize Pool Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Player Score Progression")).toBeInTheDocument();
  });

  it("shows total prize pool in description", () => {
    render(<TournamentResultsCharts data={tournamentData} />);
    // 50000 + 25000 = 75000
    expect(screen.getByText(/75,000/)).toBeInTheDocument();
  });
});
