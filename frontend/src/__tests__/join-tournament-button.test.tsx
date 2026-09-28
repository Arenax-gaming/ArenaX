import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JoinTournamentButton } from "@/components/tournaments/JoinTournamentButton";
import { Tournament } from "@/types/tournament";
import { api } from "@/lib/api";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

const mockNotify = jest.fn();
const mockAddToast = jest.fn();
const mockJoinTournament = jest.fn();

jest.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({
    notify: mockNotify,
    addToast: mockAddToast,
  }),
}));

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

/** Every render needs a QueryClientProvider now that the button uses TanStack Query (#1088). */
function renderButton(tournament: Tournament = baseTournament) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JoinTournamentButton tournament={tournament} />
    </QueryClientProvider>,
  );
}

describe("JoinTournamentButton", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockNotify.mockClear();
    mockAddToast.mockClear();
    mockJoinTournament.mockClear();
    localStorage.clear();
  });

  it("shows sign-in prompt when unauthenticated and opens modal", () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));

    expect(screen.getByText(/you need to be signed in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("calls api.joinTournament and persists joined state when authenticated", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockResolvedValue({});

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalledWith(baseTournament.id));
    await waitFor(() =>
      expect(localStorage.getItem(`tournament-joined-${baseTournament.id}`)).toBe("true"),
    );

    expect(screen.getByText(/successfully joined/i, { selector: "h2" })).toBeInTheDocument();
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Tournament Joined",
    }));
  });

  it("displays an error message when the join API fails", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockRejectedValue(new Error("Payment required"));

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/unable to join tournament/i)).toBeInTheDocument());
    expect(screen.getByText(/payment required/i)).toBeInTheDocument();
  });

  // ── Optimistic UI (#1088) ────────────────────────────────────────────────

  it("updates the main button to 'Registered' instantly, before a slow network request resolves", async () => {
    localStorage.setItem("auth_token", "token-123");
    let resolveJoin: (() => void) | undefined;
    mockJoinTournament.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveJoin = resolve;
        }),
    );

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    // Optimistic: registered immediately, well before the 2s network delay
    // a high-latency mobile connection would introduce.
    expect(await screen.findByRole("button", { name: /registered/i })).toBeInTheDocument();
    expect(mockJoinTournament).toHaveBeenCalledTimes(1);

    resolveJoin?.();
    await waitFor(() =>
      expect(localStorage.getItem(`tournament-joined-${baseTournament.id}`)).toBe("true"),
    );
  });

  it("rolls back to 'Join Tournament' and shows a toast if the optimistic join fails", async () => {
    localStorage.setItem("auth_token", "token-123");
    let rejectJoin: ((err: Error) => void) | undefined;
    mockJoinTournament.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectJoin = reject;
        }),
    );

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    // Optimistically registered while the request is in flight.
    expect(await screen.findByRole("button", { name: /registered/i })).toBeInTheDocument();

    rejectJoin?.(new Error("Tournament is full"));

    // Rolled back: the main button reverts to "Join Tournament".
    expect(await screen.findByRole("button", { name: /^join tournament$/i })).toBeInTheDocument();
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: "Tournament is full" }),
    );
    expect(localStorage.getItem(`tournament-joined-${baseTournament.id}`)).not.toBe("true");
  });

  it("does not trigger duplicate API calls when confirm is clicked multiple times rapidly", async () => {
    localStorage.setItem("auth_token", "token-123");
    // Never resolves — keeps the request in-flight throughout the test
    mockJoinTournament.mockImplementation(() => new Promise(() => {}));

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));

    const confirmButton = screen.getByRole("button", { name: /confirm join/i });
    // Click three times in rapid succession before any re-render
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalledTimes(1));
  });
});
