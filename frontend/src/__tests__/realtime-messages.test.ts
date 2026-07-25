/**
 * Tests for Real-Time Messages — Issue #697
 * Covers: WebSocketManager, MessageStore, message queue/flush, optimistic UI
 */

import { WebSocketManager, getWsEvents, clearWsEvents } from "@/messages/wsManager";
import type { ConnectionStatus } from "@/messages/wsManager";
import { MessageStore, getMessageDeliveryStats } from "@/messages/messageStore";

// ─── Mock WebSocket ───────────────────────────────────────────────────────────

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  sentMessages: string[] = [];

  constructor(public url: string) {
    // Automatically "connect" in the next microtask
    Promise.resolve().then(() => {
      this.onopen?.(new Event("open"));
    });
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code = 1000, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
  }

  // Test helper: simulate incoming message
  simulateMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

beforeAll(() => {
  (global as Record<string, unknown>).WebSocket = MockWebSocket;
});

afterEach(() => {
  clearWsEvents();
  localStorage.clear();
  jest.clearAllTimers();
  jest.useRealTimers();
});

// ─── WebSocketManager tests ───────────────────────────────────────────────────

describe("WebSocketManager", () => {
  it("transitions to connected status on open", async () => {
    const statuses: ConnectionStatus[] = [];
    const manager = new WebSocketManager({
      url: "ws://localhost/ws",
      onStatusChange: (s) => statuses.push(s),
    });

    manager.connect();
    await Promise.resolve(); // let MockWebSocket.onopen fire

    expect(statuses).toContain("connected");
  });

  it("send() returns true when connected", async () => {
    const manager = new WebSocketManager({ url: "ws://localhost/ws" });
    manager.connect();
    await Promise.resolve();

    const sent = manager.send("test_event", { data: 42 });
    expect(sent).toBe(true);
  });

  it("send() returns false when not connected", () => {
    const manager = new WebSocketManager({ url: "ws://localhost/ws" });
    // Not connected yet
    const sent = manager.send("test_event", {});
    expect(sent).toBe(false);
  });

  it("getStatus() reflects current status", async () => {
    const manager = new WebSocketManager({ url: "ws://localhost/ws" });
    expect(manager.getStatus()).toBe("idle");

    manager.connect();
    expect(manager.getStatus()).toBe("connecting");

    await Promise.resolve();
    expect(manager.getStatus()).toBe("connected");
  });

  it("disconnect() transitions to closed", async () => {
    const manager = new WebSocketManager({ url: "ws://localhost/ws" });
    manager.connect();
    await Promise.resolve();

    manager.disconnect();
    expect(manager.getStatus()).toBe("closed");
  });

  it("schedules reconnect on unexpected close", async () => {
    const statuses: ConnectionStatus[] = [];
    const manager = new WebSocketManager({
      url: "ws://localhost/ws",
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 200,
      maxReconnectAttempts: 3,
      onStatusChange: (s) => statuses.push(s),
    });

    manager.connect();
    await Promise.resolve();

    // Force unexpected close (code ≠ 1000)
    const ws = manager["ws"] as MockWebSocket;
    ws.close(1006, "Abnormal");

    // Should immediately transition to reconnecting
    expect(statuses).toContain("reconnecting");
    // Clean up the pending reconnect timer
    manager.disconnect();
  });

  it("tracks metrics: disconnections", async () => {
    const manager = new WebSocketManager({ url: "ws://localhost/ws" });
    manager.connect();
    await Promise.resolve();

    const ws = manager["ws"] as MockWebSocket;
    ws.close(1006);

    const metrics = manager.getMetrics();
    expect(metrics.disconnections).toBe(1);
  });

  it("tracks metrics: messages sent", async () => {
    const manager = new WebSocketManager({ url: "ws://localhost/ws" });
    manager.connect();
    await Promise.resolve();

    manager.send("msg", { content: "hello" });
    manager.send("msg", { content: "world" });

    const metrics = manager.getMetrics();
    expect(metrics.messagesSent).toBe(2);
  });

  it("tracks analytics events", async () => {
    clearWsEvents();
    const manager = new WebSocketManager({ url: "ws://localhost/ws" });
    manager.connect();
    await Promise.resolve();

    const events = getWsEvents();
    expect(events.some((e) => e.type === "connected")).toBe(true);
  });

  it("appends token to WS URL when getToken is provided", async () => {
    let capturedUrl = "";
    const OrigWs = (global as Record<string, unknown>).WebSocket;

    class CapturingWs extends MockWebSocket {
      constructor(url: string) {
        super(url);
        capturedUrl = url;
      }
    }
    (global as Record<string, unknown>).WebSocket = CapturingWs;

    const manager = new WebSocketManager({
      url: "ws://localhost/ws",
      getToken: () => "my-jwt-token",
    });
    manager.connect();
    await Promise.resolve();

    expect(capturedUrl).toContain("token=my-jwt-token");
    (global as Record<string, unknown>).WebSocket = OrigWs;
  });

  it("calls onPermanentDisconnect after max reconnect attempts", async () => {
    let permanentDisconnect = false;

    const manager = new WebSocketManager({
      url: "ws://localhost/ws",
      maxReconnectAttempts: 0, // exhaust immediately on first close
      reconnectBaseDelayMs: 0,
      reconnectMaxDelayMs: 0,
      onPermanentDisconnect: () => { permanentDisconnect = true; },
    });

    manager.connect();
    await Promise.resolve(); // let onopen fire

    // Close unexpectedly - should immediately hit max attempts = 0
    const ws = manager["ws"] as MockWebSocket;
    ws.close(1006, "Abnormal");

    expect(permanentDisconnect).toBe(true);
    expect(manager.getStatus()).toBe("offline");
  });
});

// ─── MessageStore tests ───────────────────────────────────────────────────────

describe("MessageStore", () => {
  let store: MessageStore;

  beforeEach(() => {
    localStorage.clear();
    store = new MessageStore();
    // Set a mock send function
    store.setSendFunction(() => true);
    store.setConnectionStatus("connected");
  });

  it("sendMessage creates an optimistic message", () => {
    const msg = store.sendMessage({
      conversationId: "conv-1",
      content: "Hello!",
      senderId: "user-1",
      senderName: "Alice",
    });

    expect(msg.optimistic).toBe(true);
    // Status is initially "pending" on the returned message object (optimistic insert)
    // The store internally updates it after send, but the returned snapshot is the initial one
    expect(msg.status).toBe("pending");
    expect(msg.content).toBe("Hello!");
  });

  it("getMessages returns messages for a conversation", () => {
    store.sendMessage({
      conversationId: "conv-1",
      content: "Message 1",
      senderId: "user-1",
      senderName: "Alice",
    });
    store.sendMessage({
      conversationId: "conv-1",
      content: "Message 2",
      senderId: "user-2",
      senderName: "Bob",
    });

    const messages = store.getMessages("conv-1");
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Message 1");
  });

  it("queues messages when offline", () => {
    const offlineStore = new MessageStore();
    let sendCalled = false;
    offlineStore.setSendFunction(() => {
      sendCalled = true;
      return false; // simulate offline
    });
    offlineStore.setConnectionStatus("connecting");

    offlineStore.sendMessage({
      conversationId: "conv-1",
      content: "Offline message",
      senderId: "user-1",
      senderName: "Alice",
    });

    expect(offlineStore.getQueue().length).toBe(1);
    expect(offlineStore.getQueue()[0].content).toBe("Offline message");
  });

  it("flushes queue on reconnection", async () => {
    // Set up disconnected store
    const queueStore = new MessageStore();
    queueStore.setConnectionStatus("connecting");
    queueStore.setSendFunction(() => false); // offline

    queueStore.sendMessage({
      conversationId: "conv-1",
      content: "Pending 1",
      senderId: "user-1",
      senderName: "Alice",
    });

    expect(queueStore.getQueue().length).toBe(1);

    // Reconnect with working send function
    queueStore.setSendFunction(() => true);
    queueStore.setConnectionStatus("connected"); // triggers flush

    await Promise.resolve(); // let flush run
    expect(queueStore.getQueue().length).toBe(0);
  });

  it("receiveMessage updates existing optimistic message to delivered", () => {
    // Set up: send message (optimistic)
    const msg = store.sendMessage({
      conversationId: "conv-2",
      content: "Optimistic",
      senderId: "user-1",
      senderName: "Alice",
    });

    // Receive server confirmation
    store.receiveMessage({
      type: "chat_message",
      payload: { ...msg, status: "delivered", optimistic: false },
      timestamp: Date.now(),
    });

    const messages = store.getMessages("conv-2");
    const updated = messages.find((m) => m.id === msg.id);
    expect(updated?.status).toBe("delivered");
    expect(updated?.optimistic).toBe(false);
  });

  it("receiveMessage adds new incoming message", () => {
    const incoming = {
      id: "server-msg-1",
      conversationId: "conv-3",
      senderId: "user-2",
      senderName: "Bob",
      content: "From server",
      type: "text" as const,
      status: "delivered" as const,
      createdAt: Date.now(),
    };

    store.receiveMessage({
      type: "chat_message",
      payload: incoming,
      timestamp: Date.now(),
    });

    const messages = store.getMessages("conv-3");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("From server");
  });

  it("markConversationRead resets unread count", () => {
    store.upsertConversation({
      id: "conv-4",
      name: "Test",
      participants: ["user-1", "user-2"],
      lastMessage: null,
      unreadCount: 5,
      updatedAt: Date.now(),
    });

    store.markConversationRead("conv-4");

    const convos = store.getAllConversations();
    const convo = convos.find((c) => c.id === "conv-4");
    expect(convo?.unreadCount).toBe(0);
  });

  it("clearConversation removes all messages", () => {
    store.sendMessage({
      conversationId: "conv-5",
      content: "Will be deleted",
      senderId: "user-1",
      senderName: "Alice",
    });

    expect(store.getMessages("conv-5").length).toBeGreaterThan(0);
    store.clearConversation("conv-5");
    expect(store.getMessages("conv-5").length).toBe(0);
  });

  it("subscribe/notify triggers listener on state change", () => {
    const listener = jest.fn();
    const unsub = store.subscribe(listener);

    store.sendMessage({
      conversationId: "conv-6",
      content: "notify test",
      senderId: "user-1",
      senderName: "Alice",
    });

    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it("unsubscribe stops listener notifications", () => {
    const listener = jest.fn();
    const unsub = store.subscribe(listener);
    unsub(); // unsubscribe immediately

    store.sendMessage({
      conversationId: "conv-7",
      content: "after unsub",
      senderId: "user-1",
      senderName: "Alice",
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("persists messages to localStorage", () => {
    store.sendMessage({
      conversationId: "conv-persist",
      content: "Persisted message",
      senderId: "user-1",
      senderName: "Alice",
    });

    const stored = localStorage.getItem("arenax_messages");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as Record<string, unknown[]>;
    expect(parsed["conv-persist"]).toHaveLength(1);
  });

  it("getMessageDeliveryStats tracks delivery rates", () => {
    store.sendMessage({ conversationId: "c1", content: "a", senderId: "u1", senderName: "U" });
    const stats = getMessageDeliveryStats();
    expect(typeof stats.sent).toBe("number");
    expect(typeof stats.deliveryRate).toBe("number");
  });
});
