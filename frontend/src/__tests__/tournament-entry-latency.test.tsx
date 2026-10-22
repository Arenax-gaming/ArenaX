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

const mockTournament: Tournament = {
  id: "latency-tourney-1",
  name: "Latency Resilient Cup",
  description: "Testing tournament entry resilience under network and payment latency",
  gameType: "Duel Arena",
  tournamentType: "single_elimination",
  entryFee: 25,
  prizePool: 1000,
  maxParticipants: 32,
  currentParticipants: 10,
  status: "registration_open",
  visibility: "public",
  startTime: new Date(Date.now() + 86400000).toISOString(),
  endTime: new Date(Date.now() + 172800000).toISOString(),
  createdBy: "admin-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function renderComponent(tournament: Tournament = mockTournament) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JoinTournamentButton tournament={tournament} />
    </QueryClientProvider>,
  );
}

describe("Issue #31 - Tournament Entry Resilience to Payment Latency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("auth_token", "test-auth-token-xyz");
  });

  /**
   * Acceptance criterion 1: Entry fee and cancellation/refund terms are visible before confirmation.
   */
  test("entry fee breakdown and refund terms are prominently displayed before confirmation", async () => {
    renderComponent();

    // Open confirmation dialog
    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));

    // Fee breakdown visible
    expect(screen.getByText(/tournament entry fee:/i)).toBeInTheDocument();
    expect(screen.getByText(/\$25\.00/i)).toBeInTheDocument();

    // Cancellation & refund policy visible
    expect(screen.getByText(/cancellation & refund terms:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/full automatic refund if tournament is cancelled or under-subscribed/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/registrations can be cancelled up to 1 hour before tournament start/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/entry fee is non-refundable once bracket matches are live/i),
    ).toBeInTheDocument();
  });

  /**
   * Acceptance criterion 2: UI does not claim a reservation until authoritative response confirms it.
   */
  test("provider delay: UI models pending state and does not claim seat during delayed response", async () => {
    let completeResponse: ((value: any) => void) | undefined;
    mockJoinTournament.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeResponse = resolve;
        }),
    );

    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    // During provider delay, pending state is modeled
    expect(screen.getByText(/reserving your seat with the server…/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reserving seat…/i })).toBeDisabled();

    // Authoritative confirmation not yet given -> not marked in localStorage or header
    expect(localStorage.getItem(`tournament-joined-${mockTournament.id}`)).toBeNull();
    expect(screen.queryByText(/successfully joined/i)).not.toBeInTheDocument();

    // Server completes round trip
    completeResponse?.({
      message: "Seat reserved",
      transactionHash: "tx_authoritative_123",
    });

    // Authoritative response confirms seat
    await waitFor(() =>
      expect(screen.getByText(/successfully joined/i)).toBeInTheDocument(),
    );
    expect(localStorage.getItem(`tournament-joined-${mockTournament.id}`)).toBe("true");
  });

  /**
   * Acceptance criterion 3: Retry reuses the same idempotency key for an unchanged join attempt.
   */
  test("retry reuses the same idempotency key across failed attempts without generating a new key", async () => {
    mockJoinTournament
      .mockRejectedValueOnce(new Error("Gateway connection timed out"))
      .mockResolvedValueOnce({ message: "Registration confirmed" });

    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() =>
      expect(screen.getByText(/gateway connection timed out/i)).toBeInTheDocument(),
    );

    const firstKey = mockJoinTournament.mock.calls[0][2];
    expect(typeof firstKey).toBe("string");
    expect(firstKey.length).toBeGreaterThan(10);

    // Click retry
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalledTimes(2));

    const retryKey = mockJoinTournament.mock.calls[1][2];
    // Must be identical idempotency key to prevent double charging
    expect(retryKey).toBe(firstKey);
  });

  /**
   * Timeout after success: authoritative idempotent retry confirms seat without duplicate charge.
   */
  test("timeout-after-success: retrying an already processed key returns success cleanly", async () => {
    // Initial attempt timed out on client side, but backend actually completed it
    mockJoinTournament
      .mockRejectedValueOnce(new Error("Client socket timeout"))
      .mockResolvedValueOnce({
        message: "Registration already confirmed",
        transactionHash: "tx_prev_123",
      });

    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() =>
      expect(screen.getByText(/client socket timeout/i)).toBeInTheDocument(),
    );

    // Retrying with the same idempotency key succeeds
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByText(/successfully joined/i)).toBeInTheDocument(),
    );
    expect(localStorage.getItem(`tournament-joined-${mockTournament.id}`)).toBe("true");
  });

  /**
   * Duplicate click prevention: rapid clicks only trigger one mutation.
   */
  test("duplicate click: rapid user interaction sends only one registration request", async () => {
    mockJoinTournament.mockImplementation(() => new Promise(() => {}));

    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));

    const confirmBtn = screen.getByRole("button", { name: /confirm join/i });
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockJoinTournament).toHaveBeenCalledTimes(1));
  });

  /**
   * Insufficient funds: displays clear error and does not reserve seat.
   */
  test("insufficient funds: informs user of payment decline and leaves seat available", async () => {
    mockJoinTournament.mockRejectedValue(new Error("Insufficient balance: 10 available, 25 required"));

    renderComponent();

    fireEvent.click(screen.getByRole("button", { name: /join tournament/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm join/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/insufficient balance: 10 available, 25 required/i),
      ).toBeInTheDocument(),
    );

    // Must not be registered
    expect(localStorage.getItem(`tournament-joined-${mockTournament.id}`)).toBeNull();
  });
});
