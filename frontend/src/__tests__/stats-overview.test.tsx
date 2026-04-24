import React from "react";
import { render, screen } from "@testing-library/react";
import { StatsOverview } from "@/components/profile/StatsOverview";
import { PlayerStats } from "@/types/profile";
import { EloPoint } from "@/types/user";

jest.mock("@/components/profile/EloChart", () => ({
  EloChart: () => <div data-testid="elo-chart" />,
}));

const baseStats: PlayerStats = {
  elo: 1500,
  globalRank: 42,
  wins: 67,
  losses: 33,
  winRate: 67.3,
  currentStreak: 3,
};

const twoPoints: EloPoint[] = [
  { date: "2024-01-01", elo: 1400 },
  { date: "2024-01-08", elo: 1500 },
];

describe("StatsOverview", () => {
  it('shows "Insufficient data for chart" when eloHistory has 0 entries', () => {
    render(<StatsOverview stats={baseStats} eloHistory={[]} />);
    expect(screen.getByText("Insufficient data for chart")).toBeInTheDocument();
    expect(screen.queryByTestId("elo-chart")).not.toBeInTheDocument();
  });

  it('shows "Insufficient data for chart" when eloHistory has 1 entry', () => {
    const onePoint: EloPoint[] = [{ date: "2024-01-01", elo: 1400 }];
    render(<StatsOverview stats={baseStats} eloHistory={onePoint} />);
    expect(screen.getByText("Insufficient data for chart")).toBeInTheDocument();
    expect(screen.queryByTestId("elo-chart")).not.toBeInTheDocument();
  });

  it("renders EloChart when eloHistory has 2 or more entries", () => {
    render(<StatsOverview stats={baseStats} eloHistory={twoPoints} />);
    expect(screen.getByTestId("elo-chart")).toBeInTheDocument();
    expect(screen.queryByText("Insufficient data for chart")).not.toBeInTheDocument();
  });

  it("displays win rate with one decimal place", () => {
    render(<StatsOverview stats={baseStats} eloHistory={[]} />);
    expect(screen.getByText("67.3%")).toBeInTheDocument();
  });

  it("displays win rate with one decimal place for a whole number", () => {
    const stats = { ...baseStats, winRate: 50 };
    render(<StatsOverview stats={stats} eloHistory={[]} />);
    expect(screen.getByText("50.0%")).toBeInTheDocument();
  });
});
