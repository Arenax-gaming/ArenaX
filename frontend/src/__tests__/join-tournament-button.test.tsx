import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { JoinTournamentButton } from "@/components/tournaments/JoinTournamentButton";
import { Tournament } from "@/types/tournament";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

const mockNotify = jest.fn();

jest.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({
    notify: mockNotify,
  }),
}));

const mockJoinTournament = jest.fn();

jest.mock("@/lib/api", () => ({
  api: {
    joinTournament: (...args: unknown[]) => mockJoinTournament(...args),
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

describe("JoinTournamentButton", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockNotify.mockClear();
    mockJoinTournament.mockClear();
    localStorage.clear();
  });

  it("shows sign-in prompt when unauthenticated and opens modal", () => {
    render(<JoinTournamentButton tournament={baseTournament} />);

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));

    expect(screen.getByText(/you need to be signed in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("calls api.joinTournament and persists joined state when authenticated", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockResolvedValue({});

    render(<JoinTournamentButton tournament={baseTournament} />);

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalledWith(baseTournament.id));

    expect(screen.getByText(/successfully joined/i, { selector: 'h2' })).toBeInTheDocument();
    expect(localStorage.getItem(`tournament-joined-${baseTournament.id}`)).toBe("true");
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Tournament Joined",
    }));
  });

  it("displays an error message when the join API fails", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockRejectedValue(new Error("Payment required"));

    render(<JoinTournamentButton tournament={baseTournament} />);

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalled());
    expect(screen.getByText(/unable to join tournament/i)).toBeInTheDocument();
    expect(screen.getByText(/payment required/i)).toBeInTheDocument();
  });
});
