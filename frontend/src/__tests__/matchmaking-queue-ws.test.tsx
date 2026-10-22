/**
 * Live matchmaking queue hook (#1216): join, WebSocket status updates,
 * match-found notification, leave on unmount, and reconnect on disconnect.
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { useMatchmakingQueue } from "@/hooks/useMatchmakingQueue";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  api: {
    joinMatchmaking: jest.fn(),
    leaveMatchmaking: jest.fn(),
    getMatchmakingStatus: jest.fn(),
  },
}));

const mockApi = api as unknown as {
  joinMatchmaking: jest.Mock;
  leaveMatchmaking: jest.Mock;
  getMatchmakingStatus: jest.Mock;
};

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = jest.fn();

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  emitMessage(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function queueEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: {
      type: "queue_status_update",
      game: "arenax",
      game_mode: "ranked",
      status: "waiting",
      position: 3,
      queue_size: 6,
      estimated_wait_time: 30,
      wait_time_so_far: 4,
      match_id: null,
      timestamp: new Date().toISOString(),
      ...overrides,
    },
  };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  mockApi.joinMatchmaking.mockResolvedValue({
    success: true,
    queue_position: 3,
    estimated_wait_time: 30,
    message: "Successfully joined queue",
  });
  mockApi.leaveMatchmaking.mockResolvedValue({
    success: true,
    message: "Successfully left queue",
  });
  mockApi.getMatchmakingStatus.mockResolvedValue({
    in_queue: true,
    queue_size: 6,
    estimated_wait_time: 30,
    wait_time_so_far: 4,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("useMatchmakingQueue", () => {
  it("joins the queue and applies live status updates", async () => {
    const { result, unmount } = renderHook(() =>
      useMatchmakingQueue({ game: "arenax", gameMode: "ranked" }),
    );

    await waitFor(() =>
      expect(mockApi.joinMatchmaking).toHaveBeenCalledWith("arenax", "ranked"),
    );
    await waitFor(() => expect(result.current.position).toBe(3));

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toContain("/ws");

    act(() => socket.onopen?.());
    expect(result.current.isConnected).toBe(true);

    act(() => socket.emitMessage(queueEvent({ position: 1, queue_size: 4 })));
    expect(result.current.position).toBe(1);
    expect(result.current.queueSize).toBe(4);
    expect(result.current.waitTime).toBe(4);

    unmount();
  });

  it("notifies once when the backend reports a found match", async () => {
    const onMatchFound = jest.fn();
    const { result, unmount } = renderHook(() =>
      useMatchmakingQueue({ game: "arenax", gameMode: "ranked", onMatchFound }),
    );

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    const socket = FakeWebSocket.instances[0];

    act(() =>
      socket.emitMessage(
        queueEvent({ status: "matched", match_id: "match-123", queue_size: 0 }),
      ),
    );

    expect(onMatchFound).toHaveBeenCalledTimes(1);
    expect(onMatchFound).toHaveBeenCalledWith("match-123");
    expect(result.current.matchId).toBe("match-123");
    expect(result.current.isSearching).toBe(false);

    // Once matched, unmounting during navigation must not cancel the spot.
    unmount();
    expect(mockApi.leaveMatchmaking).not.toHaveBeenCalled();
  });

  it("leaves the queue when unmounted while still searching", async () => {
    const { unmount } = renderHook(() =>
      useMatchmakingQueue({ game: "arenax", gameMode: "ranked" }),
    );

    await waitFor(() =>
      expect(mockApi.joinMatchmaking).toHaveBeenCalledWith("arenax", "ranked"),
    );

    unmount();
    expect(mockApi.leaveMatchmaking).toHaveBeenCalledWith("arenax", "ranked");
  });

  it("exposes leaveQueue for the cancel button", async () => {
    const { result } = renderHook(() =>
      useMatchmakingQueue({ game: "arenax", gameMode: "ranked" }),
    );

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));

    await act(async () => {
      await result.current.leaveQueue();
    });

    expect(mockApi.leaveMatchmaking).toHaveBeenCalledWith("arenax", "ranked");
    expect(result.current.isSearching).toBe(false);
  });

  it("reconnects with back-off after the socket drops", async () => {
    const { result, unmount } = renderHook(() =>
      useMatchmakingQueue({ game: "arenax", gameMode: "ranked" }),
    );

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));

    act(() => FakeWebSocket.instances[0].onclose?.());
    expect(result.current.isReconnecting).toBe(true);

    await waitFor(
      () => expect(FakeWebSocket.instances.length).toBe(2),
      { timeout: 2000 },
    );

    unmount();
  });
});
