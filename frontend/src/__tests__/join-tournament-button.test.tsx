import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { JoinTournamentButton } from "@/components/tournaments/JoinTournamentButton";
import { Tournament } from "@/types/tournament";
import { api } from "@/lib/api";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

const mockNotify = jest.fn();
const mockAddToast = jest.fn();

jest.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({
    notify: mockNotify,
    addToast: mockAddToast,
  }),
}));

jest.mock("@/lib/api", () => ({
  api: {
    joinTournament: jest.fn(),
  },
}));

const mockJoinTournament = api.joinTournament as jest.Mock;

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
    mockAddToast.mockClear();
    mockJoinTournament.mockClear();
    localStorage.clear();
  });

  // ── Existing tests ────────────────────────────────────────────────────────

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

    expect(screen.getByRole("heading", { name: /successfully joined/i })).toBeInTheDocument();
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

  // ── New tests ─────────────────────────────────────────────────────────────

  it("shows a spinner and 'Joining…' on the main button while the request is in progress", async () => {
    localStorage.setItem("auth_token", "token-123");
    // Never resolves so the component stays in loading state
    mockJoinTournament.mockImplementation(() => new Promise(() => {}));

    render(<JoinTournamentButton tournament={baseTournament} />);

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    // Main button should now read "Joining…"
    expect(screen.getByRole("button", { name: /joining/i })).toBeInTheDocument();
    // The Button component renders an SVG spinner when loading={true}
    expect(document.querySelector("svg.animate-spin")).toBeInTheDocument();
  });

  it("disables the main button while the request is in progress", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockImplementation(() => new Promise(() => {}));

    render(<JoinTournamentButton tournament={baseTournament} />);

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    expect(screen.getByRole("button", { name: /joining/i })).toBeDisabled();
  });

  it("transitions the main button to 'Registered ✓' and keeps it disabled after a successful join", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockResolvedValue({});

    render(<JoinTournamentButton tournament={baseTournament} />);

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalled());

    const registeredButton = screen.getByRole("button", { name: /registered/i });
    expect(registeredButton).toBeInTheDocument();
    expect(registeredButton).toBeDisabled();
  });

  it("shows a toast with the backend error message on failure and restores the main button to idle", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockRejectedValue(new Error("Tournament is full"));

    render(<JoinTournamentButton tournament={baseTournament} />);

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalled());

    // Toast should carry the backend error message
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        message: "Tournament is full",
      })
    );

    // Main button returns to idle — no longer in loading state
    expect(screen.queryByRole("button", { name: /joining/i })).not.toBeInTheDocument();
    // Main button re-enabled (it's behind the modal but present in the DOM)
    expect(screen.getByRole("button", { name: /join tournament/i })).not.toBeDisabled();
  });

  it("does not trigger duplicate API calls when confirm is clicked multiple times rapidly", async () => {
    localStorage.setItem("auth_token", "token-123");
    // Never resolves — keeps the request in-flight throughout the test
    mockJoinTournament.mockImplementation(() => new Promise(() => {}));

    render(<JoinTournamentButton tournament={baseTournament} />);

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));

    const confirmButton = screen.getByRole("button", { name: /confirm join/i });
    // Click three times in rapid succession before any re-render
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalledTimes(1));
  });
});
