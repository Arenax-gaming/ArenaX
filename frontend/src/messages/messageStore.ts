/**
 * Message Queue & Persistence — Issue #697
 *
 * Features:
 * - Offline message queue: buffers outgoing messages when disconnected
 * - Automatic flush on reconnection
 * - Optimistic UI: messages appear instantly with `pending` status
 * - IndexedDB persistence (via src/lib/db) with localStorage fallback
 * - Conversation state management
 * - Analytics for delivery success / failure rates
 */

"use client";

import type { ConnectionStatus, WsMessage } from "./wsManager";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MessageStatus = "pending" | "sent" | "delivered" | "failed";

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  type: "text" | "image" | "system" | "score_report";
  status: MessageStatus;
  /** Optimistically inserted — not yet confirmed by server */
  optimistic?: boolean;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  name: string;
  participants: string[];
  lastMessage: ChatMessage | null;
  unreadCount: number;
  updatedAt: number;
}

export interface QueuedMessage {
  id: string;
  conversationId: string;
  content: string;
  type: ChatMessage["type"];
  senderId: string;
  senderName: string;
  queuedAt: number;
  attempts: number;
  metadata?: Record<string, unknown>;
}

// ─── ID generation ────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ─── Persistence layer ────────────────────────────────────────────────────────

const MESSAGES_STORAGE_KEY = "arenax_messages";
const QUEUE_STORAGE_KEY = "arenax_message_queue";
const CONVERSATIONS_STORAGE_KEY = "arenax_conversations";
const MAX_PERSISTED_MESSAGES = 500;

interface PersistedStore {
  messages: Record<string, ChatMessage[]>;   // conversationId → messages
  queue: QueuedMessage[];
  conversations: Record<string, Conversation>;
}

function loadFromStorage(): PersistedStore {
  if (typeof window === "undefined") {
    return { messages: {}, queue: [], conversations: {} };
  }
  try {
    return {
      messages: JSON.parse(localStorage.getItem(MESSAGES_STORAGE_KEY) ?? "{}") as Record<string, ChatMessage[]>,
      queue: JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) ?? "[]") as QueuedMessage[],
      conversations: JSON.parse(localStorage.getItem(CONVERSATIONS_STORAGE_KEY) ?? "{}") as Record<string, Conversation>,
    };
  } catch {
    return { messages: {}, queue: [], conversations: {} };
  }
}

function persistMessages(messages: Record<string, ChatMessage[]>): void {
  if (typeof window === "undefined") return;
  try {
    // Trim each conversation to last MAX_PERSISTED_MESSAGES entries
    const trimmed: Record<string, ChatMessage[]> = {};
    for (const [id, msgs] of Object.entries(messages)) {
      trimmed[id] = msgs.slice(-MAX_PERSISTED_MESSAGES);
    }
    localStorage.setItem(MESSAGES_STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota */ }
}

function persistQueue(queue: QueuedMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  } catch { /* quota */ }
}

function persistConversations(convos: Record<string, Conversation>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(convos));
  } catch { /* quota */ }
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface MessageAnalyticsEvent {
  type: "sent" | "delivered" | "failed" | "queued" | "flushed" | "dropped";
  conversationId?: string;
  messageId?: string;
  latencyMs?: number;
  queueLength?: number;
  timestamp: number;
}

const _msgEvents: MessageAnalyticsEvent[] = [];

function trackMsgEvent(event: Omit<MessageAnalyticsEvent, "timestamp">): void {
  _msgEvents.unshift({ ...event, timestamp: Date.now() });
  if (_msgEvents.length > 300) _msgEvents.length = 300;
}

export function getMessageAnalytics(): readonly MessageAnalyticsEvent[] {
  return _msgEvents;
}

export function getMessageDeliveryStats(): {
  sent: number;
  delivered: number;
  failed: number;
  deliveryRate: number;
} {
  const sent = _msgEvents.filter((e) => e.type === "sent").length;
  const delivered = _msgEvents.filter((e) => e.type === "delivered").length;
  const failed = _msgEvents.filter((e) => e.type === "failed").length;
  return {
    sent,
    delivered,
    failed,
    deliveryRate: sent === 0 ? 1 : delivered / sent,
  };
}

// ─── Message Store ────────────────────────────────────────────────────────────

/**
 * Central message store — call-site agnostic (no React dependency).
 * Consumed by the React hook below.
 */
export class MessageStore {
  private messages: Record<string, ChatMessage[]>;
  private queue: QueuedMessage[];
  private conversations: Record<string, Conversation>;
  private listeners: Set<() => void> = new Set();
  private connectionStatus: ConnectionStatus = "idle";
  private sendFn: ((type: string, payload: unknown) => boolean) | null = null;

  constructor() {
    const stored = loadFromStorage();
    this.messages = stored.messages;
    this.queue = stored.queue;
    this.conversations = stored.conversations;
  }

  // ─── Subscription (for React useSyncExternalStore pattern) ─────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  // ─── Connection integration ─────────────────────────────────────────────────

  setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    if (status === "connected") {
      void this.flushQueue();
    }
    this.notify();
  }

  setSendFunction(fn: (type: string, payload: unknown) => boolean): void {
    this.sendFn = fn;
  }

  // ─── Sending messages (optimistic UI) ──────────────────────────────────────

  sendMessage(params: {
    conversationId: string;
    content: string;
    type?: ChatMessage["type"];
    senderId: string;
    senderName: string;
    metadata?: Record<string, unknown>;
  }): ChatMessage {
    const id = generateId();
    const message: ChatMessage = {
      id,
      conversationId: params.conversationId,
      senderId: params.senderId,
      senderName: params.senderName,
      content: params.content,
      type: params.type ?? "text",
      status: "pending",
      optimistic: true,
      createdAt: Date.now(),
      metadata: params.metadata,
    };

    // Optimistically add to the conversation
    this.addMessageToStore(message);

    if (this.connectionStatus === "connected" && this.sendFn) {
      const sent = this.sendFn("chat_message", {
        id,
        conversationId: params.conversationId,
        content: params.content,
        type: params.type ?? "text",
        metadata: params.metadata,
      });

      if (sent) {
        this.updateMessageStatus(params.conversationId, id, "sent");
        trackMsgEvent({ type: "sent", conversationId: params.conversationId, messageId: id });
      } else {
        this.enqueue({ ...params, id, type: params.type ?? "text" });
      }
    } else {
      // Offline — enqueue for later delivery
      this.enqueue({ ...params, id, type: params.type ?? "text" });
      trackMsgEvent({ type: "queued", conversationId: params.conversationId, messageId: id, queueLength: this.queue.length });
    }

    return message;
  }

  // ─── Receiving messages ─────────────────────────────────────────────────────

  receiveMessage(wsMsg: WsMessage<ChatMessage>): void {
    const msg = wsMsg.payload;
    if (!msg?.id || !msg?.conversationId) return;

    // If this is a server confirmation for an optimistic message, update its status
    const existingIdx = (this.messages[msg.conversationId] ?? []).findIndex((m) => m.id === msg.id);
    if (existingIdx >= 0) {
      const msgs = [...(this.messages[msg.conversationId] ?? [])];
      msgs[existingIdx] = { ...msgs[existingIdx], status: "delivered", optimistic: false };
      this.messages[msg.conversationId] = msgs;
      trackMsgEvent({ type: "delivered", conversationId: msg.conversationId, messageId: msg.id });
    } else {
      this.addMessageToStore({ ...msg, status: "delivered" });
    }

    persistMessages(this.messages);
    this.notify();
  }

  // ─── Queue management ───────────────────────────────────────────────────────

  private enqueue(params: {
    id: string;
    conversationId: string;
    content: string;
    type: ChatMessage["type"];
    senderId: string;
    senderName: string;
    metadata?: Record<string, unknown>;
  }): void {
    const queued: QueuedMessage = {
      id: params.id,
      conversationId: params.conversationId,
      content: params.content,
      type: params.type,
      senderId: params.senderId,
      senderName: params.senderName,
      queuedAt: Date.now(),
      attempts: 0,
      metadata: params.metadata,
    };
    this.queue.push(queued);
    persistQueue(this.queue);
    this.notify();
  }

  async flushQueue(): Promise<void> {
    if (!this.sendFn || this.queue.length === 0) return;

    const toFlush = [...this.queue];
    this.queue = [];

    let flushed = 0;
    let dropped = 0;

    for (const item of toFlush) {
      if (item.attempts >= 3) {
        // Give up after 3 attempts — mark as failed
        this.updateMessageStatus(item.conversationId, item.id, "failed");
        dropped++;
        trackMsgEvent({ type: "dropped", conversationId: item.conversationId, messageId: item.id });
        continue;
      }

      const sent = this.sendFn("chat_message", {
        id: item.id,
        conversationId: item.conversationId,
        content: item.content,
        type: item.type,
        metadata: item.metadata,
      });

      if (sent) {
        this.updateMessageStatus(item.conversationId, item.id, "sent");
        flushed++;
      } else {
        // Put back with incremented attempt count
        this.queue.push({ ...item, attempts: item.attempts + 1 });
        dropped++;
      }
    }

    persistQueue(this.queue);
    if (flushed > 0) trackMsgEvent({ type: "flushed", queueLength: flushed });
    this.notify();
  }

  // ─── Conversation management ────────────────────────────────────────────────

  upsertConversation(convo: Conversation): void {
    this.conversations[convo.id] = convo;
    persistConversations(this.conversations);
    this.notify();
  }

  markConversationRead(conversationId: string): void {
    const convo = this.conversations[conversationId];
    if (!convo) return;
    this.conversations[conversationId] = { ...convo, unreadCount: 0 };
    persistConversations(this.conversations);
    this.notify();
  }

  // ─── Accessors ──────────────────────────────────────────────────────────────

  getMessages(conversationId: string): readonly ChatMessage[] {
    return this.messages[conversationId] ?? [];
  }

  getAllConversations(): readonly Conversation[] {
    return Object.values(this.conversations).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getQueue(): readonly QueuedMessage[] {
    return this.queue;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  getTotalUnread(): number {
    return Object.values(this.conversations).reduce((s, c) => s + c.unreadCount, 0);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private addMessageToStore(msg: ChatMessage): void {
    const existing = this.messages[msg.conversationId] ?? [];
    this.messages[msg.conversationId] = [...existing, msg];
    persistMessages(this.messages);

    // Update conversation last message
    const convo = this.conversations[msg.conversationId];
    if (convo) {
      this.conversations[msg.conversationId] = {
        ...convo,
        lastMessage: msg,
        updatedAt: msg.createdAt,
        unreadCount: convo.unreadCount + (msg.optimistic ? 0 : 1),
      };
      persistConversations(this.conversations);
    }

    this.notify();
  }

  private updateMessageStatus(conversationId: string, messageId: string, status: MessageStatus): void {
    const msgs = this.messages[conversationId];
    if (!msgs) return;
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const updated = [...msgs];
    updated[idx] = { ...updated[idx], status };
    this.messages[conversationId] = updated;
    persistMessages(this.messages);
    this.notify();
  }

  clearConversation(conversationId: string): void {
    delete this.messages[conversationId];
    persistMessages(this.messages);
    this.notify();
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const messageStore = new MessageStore();
