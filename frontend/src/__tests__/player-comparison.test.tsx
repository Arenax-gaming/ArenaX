import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  PlayerComparison,
  determineWinner,
} from "@/components/profile/PlayerComparison";
import { ProfilePageClient } from "@/app/[locale]/profile/[id]/ProfilePageClient";
import { api } from "@/lib/api";
import { usePlayerComparison } from "@/hooks/usePlayerComparison";
import type {
  PublicProfile,
  PlayerStats,
  FriendEntry,
  PlayerComparisonStats,
  BatchPlayerStatsResponse,
} from "@/types/profile";

// Mock next/navigation
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/profile/user-123",
}));

// Mock hooks and child components of ProfilePageClient to isolate profile test
jest.mock("@/components/profile/ProfileHeader", () => ({
  ProfileHeader: () => <div data-testid="profile-header" />,
}));
jest.mock("@/components/profile/StatsOverview", () => ({
  StatsOverview: () => <div data-testid="stats-overview" />,
}));
jest.mock("@/components/profile/MatchHistory", () => ({
  MatchHistory: () => <div data-testid="match-history" />,
}));
jest.mock("@/components/profile/AchievementShowcase", () => ({
  AchievementShowcase: () => <div data-testid="achievement-showcase" />,
}));
jest.mock("@/components/profile/FriendsList", () => ({
  FriendsList: () => <div data-testid="friends-list" />,
}));
jest.mock("@/components/profile/ActivityFeed", () => ({
  ActivityFeed: () => <div data-testid="activity-feed" />,
}));
jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

// Mock usePlayerComparison hook for component tests
jest.mock("@/hooks/usePlayerComparison");
const mockedUsePlayerComparison = usePlayerComparison as jest.MockedFunction<
  typeof usePlayerComparison
>;

const primaryProfile: PublicProfile = {
  id: "user-123",
  username: "ProGamer99",
  avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ProGamer99",
  bio: "Competitive player.",
  elo: 1250,
  globalRank: 42,
  createdAt: "2026-01-01T10:00:00Z",
  isOnline: true,
  customization: { banner: "default", colorTheme: "blue" },
  privacySettings: {
    stats: "everyone",
    matchHistory: "everyone",
    achievements: "everyone",
    friends: "everyone",
    activityFeed: "everyone",
  },
};

const primaryStats: PlayerStats = {
  elo: 1250,
  globalRank: 42,
  wins: 67,
  losses: 33,
  winRate: 67.0,
  currentStreak: 3,
  tournamentWins: 5,
  reputationScore: 92,
};

const mockFriends: FriendEntry[] = [
  {
    id: "user-456",
    username: "ShadowNinja",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ShadowNinja",
    elo: 1180,
    status: "online",
    gamesPlayed: 100,
  },
  {
    id: "user-789",
    username: "CyberKnight",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=CyberKnight",
    elo: 1320,
    status: "offline",
    gamesPlayed: 150,
  },
];

const mockBatchStats: BatchPlayerStatsResponse = {
  players: {
    "user-123": {
      playerId: "user-123",
      username: "ProGamer99",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ProGamer99",
      winRate: 67.0,
      averageElo: 1250,
      matchesPlayed: 100,
      tournamentWins: 5,
      reputationScore: 92,
    },
    "user-456": {
      playerId: "user-456",
      username: "ShadowNinja",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=ShadowNinja",
      winRate: 45.0,
      averageElo: 1180,
      matchesPlayed: 100, // Equal matches played for testing ties
      tournamentWins: 2,
      reputationScore: 98,
    },
  },
};

describe("Player vs Player Stats Comparison (Issue #1398)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  describe("determineWinner helper logic", () => {
    it("correctly identifies winner when value is greater", () => {
      expect(determineWinner(67.0, 45.0)).toBe("player1");
      expect(determineWinner(1180, 1250)).toBe("player2");
      expect(determineWinner(5, 2)).toBe("player1");
      expect(determineWinner(92, 98)).toBe("player2");
    });

    it("does not designate a winner when values are equal (tie)", () => {
      expect(determineWinner(100, 100)).toBe("tie");
      expect(determineWinner(50.0, 50.0)).toBe("tie");
      expect(determineWinner(0, 0)).toBe("tie");
    });

    it("does not designate a winner when values are missing (null/undefined/NaN)", () => {
      expect(determineWinner(null, 50)).toBe("none");
      expect(determineWinner(50, undefined)).toBe("none");
      expect(determineWinner(NaN, 50)).toBe("none");
      expect(determineWinner(undefined, undefined)).toBe("none");
    });
  });

  describe("PlayerComparison component", () => {
    beforeEach(() => {
      mockedUsePlayerComparison.mockReturnValue({
        data: mockBatchStats,
        player1Stats: mockBatchStats.players["user-123"],
        player2Stats: mockBatchStats.players["user-456"],
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      });
    });

    it("renders both players' identities side by side", () => {
      render(
        <PlayerComparison
          primaryProfile={primaryProfile}
          primaryStats={primaryStats}
          availableFriends={mockFriends}
          selectedOpponentId="user-456"
          onSelectOpponent={jest.fn()}
        />
      );

      expect(screen.getByTestId("primary-player-name")).toHaveTextContent("ProGamer99");
      expect(screen.getByTestId("opponent-player-name")).toHaveTextContent("ShadowNinja");
    });

    it("displays all five required statistical categories", () => {
      render(
        <PlayerComparison
          primaryProfile={primaryProfile}
          primaryStats={primaryStats}
          availableFriends={mockFriends}
          selectedOpponentId="user-456"
          onSelectOpponent={jest.fn()}
        />
      );

      // 1. Win rate
      expect(screen.getByTestId("stat-row-win-rate")).toBeInTheDocument();
      expect(screen.getByTestId("p1-stat-winRate")).toHaveTextContent("67.0%");
      expect(screen.getByTestId("p2-stat-winRate")).toHaveTextContent("45.0%");

      // 2. Average ELO
      expect(screen.getByTestId("stat-row-average-elo")).toBeInTheDocument();
      expect(screen.getByTestId("p1-stat-averageElo")).toHaveTextContent("1,250");
      expect(screen.getByTestId("p2-stat-averageElo")).toHaveTextContent("1,180");

      // 3. Matches played
      expect(screen.getByTestId("stat-row-matches-played")).toBeInTheDocument();
      expect(screen.getByTestId("p1-stat-matchesPlayed")).toHaveTextContent("100");
      expect(screen.getByTestId("p2-stat-matchesPlayed")).toHaveTextContent("100");

      // 4. Tournament wins
      expect(screen.getByTestId("stat-row-tournament-wins")).toBeInTheDocument();
      expect(screen.getByTestId("p1-stat-tournamentWins")).toHaveTextContent("5");
      expect(screen.getByTestId("p2-stat-tournamentWins")).toHaveTextContent("2");

      // 5. Reputation score
      expect(screen.getByTestId("stat-row-reputation-score")).toBeInTheDocument();
      expect(screen.getByTestId("p1-stat-reputationScore")).toHaveTextContent("92 pts");
      expect(screen.getByTestId("p2-stat-reputationScore")).toHaveTextContent("98 pts");
    });

    it("highlights the winner of each category when one value is better", () => {
      render(
        <PlayerComparison
          primaryProfile={primaryProfile}
          primaryStats={primaryStats}
          availableFriends={mockFriends}
          selectedOpponentId="user-456"
          onSelectOpponent={jest.fn()}
        />
      );

      // Win rate: Player 1 has 67% vs Player 2's 45% -> Player 1 wins
      const winRateWinner = screen.getByTestId("category-winner-winRate");
      expect(winRateWinner).toBeInTheDocument();
      expect(screen.getByTestId("p1-stat-winRate")).toContainElement(winRateWinner);

      // Average ELO: Player 1 has 1250 vs Player 2's 1180 -> Player 1 wins
      const eloWinner = screen.getByTestId("category-winner-averageElo");
      expect(eloWinner).toBeInTheDocument();
      expect(screen.getByTestId("p1-stat-averageElo")).toContainElement(eloWinner);

      // Tournament wins: Player 1 has 5 vs Player 2's 2 -> Player 1 wins
      const tourneyWinner = screen.getByTestId("category-winner-tournamentWins");
      expect(tourneyWinner).toBeInTheDocument();
      expect(screen.getByTestId("p1-stat-tournamentWins")).toContainElement(tourneyWinner);

      // Reputation score: Player 2 has 98 vs Player 1's 92 -> Player 2 wins
      const repWinner = screen.getByTestId("category-winner-reputationScore");
      expect(repWinner).toBeInTheDocument();
      expect(screen.getByTestId("p2-stat-reputationScore")).toContainElement(repWinner);
    });

    it("does not designate a winner when values are equal (tie)", () => {
      render(
        <PlayerComparison
          primaryProfile={primaryProfile}
          primaryStats={primaryStats}
          availableFriends={mockFriends}
          selectedOpponentId="user-456"
          onSelectOpponent={jest.fn()}
        />
      );

      // Matches played: Both players have 100 -> Tie! No winner tag.
      expect(screen.queryByTestId("category-winner-matchesPlayed")).not.toBeInTheDocument();
    });

    it("handles missing values safely without crashing or declaring a winner", () => {
      mockedUsePlayerComparison.mockReturnValue({
        data: {
          players: {
            "user-123": {
              playerId: "user-123",
              winRate: 60.0,
              averageElo: 1200,
              matchesPlayed: 50,
              tournamentWins: 1,
              reputationScore: 100,
            },
            "user-456": {
              playerId: "user-456",
              // Missing optional or undefined stats
              winRate: (undefined as unknown) as number,
              averageElo: 1200,
              matchesPlayed: 50,
              tournamentWins: 1,
              reputationScore: 100,
            },
          },
        },
        player1Stats: {
          playerId: "user-123",
          winRate: 60.0,
          averageElo: 1200,
          matchesPlayed: 50,
          tournamentWins: 1,
          reputationScore: 100,
        },
        player2Stats: {
          playerId: "user-456",
          winRate: (undefined as unknown) as number,
          averageElo: 1200,
          matchesPlayed: 50,
          tournamentWins: 1,
          reputationScore: 100,
        },
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
      });

      render(
        <PlayerComparison
          primaryProfile={primaryProfile}
          primaryStats={primaryStats}
          availableFriends={mockFriends}
          selectedOpponentId="user-456"
          onSelectOpponent={jest.fn()}
        />
      );

      // When winRate is missing for player 2, no winner must be declared
      expect(screen.queryByTestId("category-winner-winRate")).not.toBeInTheDocument();
      expect(screen.getByTestId("p2-stat-winRate")).toHaveTextContent("—");
    });

    it("allows user to select opponent from available friends or manual ID", () => {
      const handleSelect = jest.fn();
      render(
        <PlayerComparison
          primaryProfile={primaryProfile}
          primaryStats={primaryStats}
          availableFriends={mockFriends}
          selectedOpponentId={null}
          onSelectOpponent={handleSelect}
        />
      );

      // Friends quick-pick button
      const friendBtn = screen.getByTestId("select-opponent-user-456");
      fireEvent.click(friendBtn);
      expect(handleSelect).toHaveBeenCalledWith("user-456");

      // Manual input
      const input = screen.getByTestId("opponent-select-input");
      fireEvent.change(input, { target: { value: "user-789" } });
      const compareBtn = screen.getByTestId("apply-opponent-button");
      fireEvent.click(compareBtn);
      expect(handleSelect).toHaveBeenCalledWith("user-789");
    });

    it("renders loading skeleton during batch API request", () => {
      mockedUsePlayerComparison.mockReturnValue({
        data: undefined,
        player1Stats: undefined,
        player2Stats: undefined,
        isLoading: true,
        isError: false,
        error: null,
        refetch: jest.fn(),
      });

      render(
        <PlayerComparison
          primaryProfile={primaryProfile}
          primaryStats={primaryStats}
          availableFriends={mockFriends}
          selectedOpponentId="user-456"
          onSelectOpponent={jest.fn()}
        />
      );

      expect(screen.getByTestId("comparison-loading-skeleton")).toBeInTheDocument();
    });

    it("renders error state when batch API call fails", () => {
      const mockRefetch = jest.fn();
      mockedUsePlayerComparison.mockReturnValue({
        data: undefined,
        player1Stats: undefined,
        player2Stats: undefined,
        isLoading: false,
        isError: true,
        error: new Error("Network timeout"),
        refetch: mockRefetch,
      });

      render(
        <PlayerComparison
          primaryProfile={primaryProfile}
          primaryStats={primaryStats}
          availableFriends={mockFriends}
          selectedOpponentId="user-456"
          onSelectOpponent={jest.fn()}
        />
      );

      expect(screen.getByTestId("comparison-error-state")).toBeInTheDocument();
      expect(screen.getByText("Network timeout")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Retry"));
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe("Profile Page Integration & URL Query Parameter Handling", () => {
    it("renders Compare button on the player profile", () => {
      render(
        <ProfilePageClient
          profile={primaryProfile}
          stats={primaryStats}
          achievements={[]}
          friends={mockFriends}
          activities={[]}
          eloHistory={[]}
        />
      );

      const compareBtn = screen.getByTestId("profile-compare-button");
      expect(compareBtn).toBeInTheDocument();
      expect(compareBtn).toHaveTextContent("Compare");
    });

    it("activating Compare opens comparison view with the current player", () => {
      render(
        <ProfilePageClient
          profile={primaryProfile}
          stats={primaryStats}
          achievements={[]}
          friends={mockFriends}
          activities={[]}
          eloHistory={[]}
        />
      );

      const compareBtn = screen.getByTestId("profile-compare-button");
      fireEvent.click(compareBtn);

      expect(screen.getByTestId("player-comparison-view")).toBeInTheDocument();
    });

    it("reads opponent ID from query parameter and restores comparison automatically", () => {
      mockSearchParams = new URLSearchParams("opponentId=user-456");

      render(
        <ProfilePageClient
          profile={primaryProfile}
          stats={primaryStats}
          achievements={[]}
          friends={mockFriends}
          activities={[]}
          eloHistory={[]}
        />
      );

      // Comparison view should automatically be open with the opponent
      expect(screen.getByTestId("player-comparison-view")).toBeInTheDocument();
      expect(mockedUsePlayerComparison).toHaveBeenCalledWith("user-123", "user-456");
    });

    it("updates URL query parameter when opponent changes", () => {
      render(
        <ProfilePageClient
          profile={primaryProfile}
          stats={primaryStats}
          achievements={[]}
          friends={mockFriends}
          activities={[]}
          eloHistory={[]}
        />
      );

      // Open comparison
      fireEvent.click(screen.getByTestId("profile-compare-button"));

      // Select an opponent
      const friendBtn = screen.getByTestId("select-opponent-user-456");
      fireEvent.click(friendBtn);

      // URL should be updated with opponentId query parameter
      expect(mockPush).toHaveBeenCalledWith("/profile/user-123?opponentId=user-456");
    });
  });

  describe("Single Batch API Call Verification", () => {
    it("requests both players' statistics through a single batch API call", async () => {
      const mockRequest = jest.spyOn(api as unknown as { request: jest.Mock }, "request").mockResolvedValue(mockBatchStats);

      const result = await api.getPlayerComparisonStats(["user-123", "user-456"]);

      // Verify that api.request was called once with both IDs in query param
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockRequest).toHaveBeenCalledWith("/stats/compare?player_ids=user-123%2Cuser-456");
      expect(result.players["user-123"]).toBeDefined();
      expect(result.players["user-456"]).toBeDefined();

      mockRequest.mockRestore();
    });
  });
});
