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

describe("JoinTournamentButton (#31)", () => {
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

  it("shows entry fee and cancellation terms before confirmation", () => {
    localStorage.setItem("auth_token", "token-123");
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));

    expect(screen.getByText(/cancellation & refund terms/i)).toBeInTheDocument();
    expect(screen.getByText(/tournament entry fee:/i)).toBeInTheDocument();
    expect(screen.getByText(/\$10\.00/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm join/i })).toBeInTheDocument();
  });

  it("calls api.joinTournament with idempotency key and updates to registered upon authoritative response", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockResolvedValue({ message: "Registration successful" });

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() =>
      expect(mockJoinTournament).toHaveBeenCalledWith(
        baseTournament.id,
        undefined,
        expect.stringMatching(/^join-t1-/),
      ),
    );

    await waitFor(() =>
      expect(localStorage.getItem(`tournament-joined-${baseTournament.id}`)).toBe("true"),
    );

    expect(screen.getByText(/successfully joined/i, { selector: "h2" })).toBeInTheDocument();
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Tournament Joined",
      }),
    );
  });

  it("does not claim a reservation until authoritative response confirms it", async () => {
    localStorage.setItem("auth_token", "token-123");
    let resolveJoin: ((val: unknown) => void) | undefined;
    mockJoinTournament.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveJoin = resolve;
        }),
    );

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    // While pending, UI must NOT claim registered
    expect(screen.queryByRole("button", { name: /registered ✓/i })).not.toBeInTheDocument();
    expect(screen.getByText(/reserving your seat with the server…/i)).toBeInTheDocument();
    expect(localStorage.getItem(`tournament-joined-${baseTournament.id}`)).toBeNull();

    // Now resolve authoritatively
    resolveJoin?.({ message: "Joined" });

    await waitFor(() =>
      expect(localStorage.getItem(`tournament-joined-${baseTournament.id}`)).toBe("true"),
    );
  });

  it("reuses the same idempotency key when retrying after a failure", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({ message: "Joined" });

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() => expect(screen.getByText(/network timeout/i)).toBeInTheDocument());

    const firstCallKey = mockJoinTournament.mock.calls[0][2];
    expect(firstCallKey).toMatch(/^join-t1-/);

    // Click Retry
    const retryButton = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalledTimes(2));

    const secondCallKey = mockJoinTournament.mock.calls[1][2];
    expect(secondCallKey).toBe(firstCallKey);
  });

  it("handles insufficient funds error cleanly without claiming seat", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockRejectedValue(new Error("Insufficient balance in wallet"));

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() => expect(screen.getByText(/insufficient balance in wallet/i)).toBeInTheDocument());
    expect(localStorage.getItem(`tournament-joined-${baseTournament.id}`)).toBeNull();
  });

  it("does not trigger duplicate API calls when confirm is clicked multiple times rapidly", async () => {
    localStorage.setItem("auth_token", "token-123");
    mockJoinTournament.mockImplementation(() => new Promise(() => {}));

    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));

    const confirmButton = screen.getByRole("button", { name: /confirm join/i });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalledTimes(1));
  });
});
