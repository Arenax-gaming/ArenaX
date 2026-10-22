import React from "react";
import { render, screen } from "@testing-library/react";
import MatchmakingQueue from "@/components/game/MatchmakingQueue";
import {
  useMatchmakingQueue,
  type UseMatchmakingQueueReturn,
} from "@/hooks/useMatchmakingQueue";

jest.mock("@/hooks/useMatchmakingQueue", () => ({
  useMatchmakingQueue: jest.fn(),
}));

const mockUseQueue = useMatchmakingQueue as jest.MockedFunction<
  typeof useMatchmakingQueue
>;

const baseState: UseMatchmakingQueueReturn = {
  position: 3,
  queueSize: 7,
  estimatedWaitTime: 30,
  waitTime: 5,
  isSearching: true,
  isConnected: true,
  isReconnecting: false,
  connectionError: null,
  matchId: null,
  leaveQueue: jest.fn(),
  reconnect: jest.fn(),
};

function renderQueue(overrides: Partial<UseMatchmakingQueueReturn> = {}) {
  mockUseQueue.mockReturnValue({ ...baseState, ...overrides });
  return render(
    <MatchmakingQueue gameMode="ranked" onCancel={jest.fn()} onMatchFound={jest.fn()} />,
  );
}

describe("MatchmakingQueue queue stats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the live queue position and queue size", () => {
    renderQueue();

    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Queue Position")).toBeInTheDocument();
    expect(screen.getByText("Players in Queue")).toBeInTheDocument();
  });

  it("shows the wait time and a formatted estimated wait", () => {
    renderQueue();

    expect(screen.getByText("0:05")).toBeInTheDocument();
    expect(screen.getByText("~0:30")).toBeInTheDocument();
  });

  it("shows a placeholder while the estimate has not arrived", () => {
    renderQueue({ estimatedWaitTime: null });

    expect(screen.getByText("Calculating…")).toBeInTheDocument();
  });

  it("surfaces a connection problem and offers a retry", () => {
    const reconnect = jest.fn();
    renderQueue({ isConnected: false, connectionError: "Queue connection interrupted.", reconnect });

    expect(screen.getByRole("alert")).toHaveTextContent("Queue connection interrupted.");
    screen.getByRole("button", { name: "Retry connection" }).click();
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("shows the matched state once the hook reports a match", () => {
    renderQueue({ isSearching: false, matchId: "match-123" });

    expect(
      screen.getByRole("heading", { name: "Match Found!" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel Matchmaking" }),
    ).toBeDisabled();
  });
});
