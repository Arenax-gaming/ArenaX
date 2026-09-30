/**
 * Dashboard skeleton loading states — Issue #1101.
 *
 * Verifies each dashboard widget renders shape-matched skeletons while its
 * data is loading (no cumulative layout shift):
 *  - StatsOverview → 4 stat-card skeletons
 *  - FriendsList    → 5 skeleton friend rows
 *  - RecentGames    → 3 skeleton game-row items
 */

import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StatsOverview } from "@/components/dashboard/StatsOverview";
import { FriendsList } from "@/components/dashboard/FriendsList";
import { RecentGames } from "@/components/dashboard/RecentGames";

function countSkeletons(container: HTMLElement): number {
  return container.querySelectorAll(".animate-pulse").length;
}

describe("StatsOverview — loading", () => {
  it("shows 4 stat-card skeletons while loading", () => {
    const { container } = render(
      <StatsOverview
        elo={0}
        wins={0}
        losses={0}
        winRate={0}
        rank={0}
        streak={0}
        isLoading
      />,
    );
    expect(countSkeletons(container)).toBeGreaterThanOrEqual(4);
  });

  it("does not show skeletons when data has loaded", () => {
    const { container } = render(
      <StatsOverview elo={1400} wins={10} losses={5} winRate={66} rank={42} streak={2} />,
    );
    expect(countSkeletons(container)).toBe(0);
  });
});

describe("FriendsList — loading", () => {
  it("shows 5 skeleton friend rows while loading", () => {
    const { container } = render(<FriendsList friends={[]} isLoading />);
    expect(countSkeletons(container)).toBeGreaterThanOrEqual(10);
  });

  it("renders friend rows once data is available", () => {
    const { queryByText } = render(
      <FriendsList
        friends={[{ id: "f1", username: "ShadowNinja", elo: 1380, status: "online" }]}
      />,
    );
    expect(queryByText("ShadowNinja")).toBeInTheDocument();
  });
});

describe("RecentGames — loading", () => {
  it("shows 3 skeleton game-row items while match history loads", () => {
    const { container } = render(
      <RecentGames matches={[]} currentUserId="u1" isLoading />,
    );
    expect(countSkeletons(container)).toBeGreaterThanOrEqual(3);
  });

  it("renders match rows once data is loaded", () => {
    const match = {
      id: "m1",
      player1Id: "u1",
      player2Id: "u2",
      player1Username: "Alpha",
      player2Username: "Beta",
      scorePlayer1: 3,
      scorePlayer2: 1,
      winnerId: "u1",
      gameType: "Battle Arena",
      status: "completed" as const,
      completedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    const { getByText } = render(
      <RecentGames matches={[match]} currentUserId="u1" />,
    );
    expect(getByText(/vs Beta/)).toBeInTheDocument();
  });

  it("shows the empty state when there are no recent games", () => {
    const { getByText } = render(<RecentGames matches={[]} currentUserId="u1" />);
    expect(getByText("No games yet")).toBeInTheDocument();
  });
});