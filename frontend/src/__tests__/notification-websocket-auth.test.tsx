import React from "react";
import { act, render } from "@testing-library/react";
import { NotificationProvider } from "@/contexts/NotificationContext";

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

jest.mock("@/lib/api", () => ({
  api: {
    getNotifications: jest.fn().mockResolvedValue([]),
    markNotificationRead: jest.fn().mockResolvedValue(undefined),
    markAllNotificationsRead: jest.fn().mockResolvedValue(undefined),
    deleteNotification: jest.fn().mockResolvedValue(undefined),
    createNotification: jest.fn().mockResolvedValue(undefined),
    getWsToken: jest.fn().mockResolvedValue({ ws_token: "test-jwt-token", expires_in: 60 }),
  },
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  // Does not fire onclose synchronously — tests dispatch close events
  // themselves, mirroring the async close of a real WebSocket.
  close() {
    this.closed = true;
  }
}

const renderProvider = async () => {
  render(
    <NotificationProvider>
      <div />
    </NotificationProvider>
  );
  // Flush the initial refreshNotifications() call
  await act(async () => {});
  return MockWebSocket.instances[0];
};

describe("NotificationContext WebSocket auth", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    (global as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket;
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("auth_token", "test-jwt-token");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("connects without the token in the URL", async () => {
    const socket = await renderProvider();

    expect(socket).toBeDefined();
    expect(socket.url).toContain("/ws/notifications");
    expect(socket.url).not.toContain("token");
    expect(socket.url).not.toContain("test-jwt-token");
  });

  it("sends an auth message as the first message after the socket opens", async () => {
    const socket = await renderProvider();

    act(() => {
      socket.onopen?.();
    });

    expect(socket.sent.length).toBeGreaterThan(0);
    expect(JSON.parse(socket.sent[0])).toEqual({
      type: "auth",
      token: "test-jwt-token",
    });
  });

  it("closes the socket and stops reconnecting when auth is rejected", async () => {
    const socket = await renderProvider();

    act(() => {
      socket.onopen?.();
      socket.onmessage?.({ data: JSON.stringify({ type: "auth_error" }) });
    });

    expect(socket.closed).toBe(true);

    act(() => {
      socket.onclose?.({ code: 1000 });
      jest.advanceTimersByTime(30_000);
    });

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("does not reconnect after an auth-failure close code", async () => {
    const socket = await renderProvider();

    act(() => {
      socket.onclose?.({ code: 4401 });
      jest.advanceTimersByTime(30_000);
    });

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("still reconnects after a normal connection drop", async () => {
    const socket = await renderProvider();

    await act(async () => {
      socket.onclose?.({ code: 1006 });
      // Use the async variant so the getWsToken() promise (microtask) that
      // precedes creating the replacement socket gets flushed.
      await jest.advanceTimersByTimeAsync(5_000);
    });

    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
  });

  it("does not surface auth acknowledgements as notifications", async () => {
    const socket = await renderProvider();

    act(() => {
      socket.onopen?.();
      socket.onmessage?.({ data: JSON.stringify({ type: "auth_ok" }) });
    });

    const stored = JSON.parse(
      localStorage.getItem("arenax_notifications") ?? "[]"
    );
    expect(stored).toEqual([]);
  });
});
