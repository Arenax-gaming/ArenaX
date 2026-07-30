/**
 * useRealtimeMessages — Issue #697
 *
 * React hook that combines WebSocketManager + MessageStore into a
 * composable, SSR-safe API.
 *
 * Usage:
 *   const { messages, sendMessage, status } = useRealtimeMessages({ conversationId: "match-42" });
 */

"use client";

import { useCallback, useEffect, useSyncExternalStore, useRef } from "react";
import { WebSocketManager, type ConnectionStatus, type WsMessage } from "./wsManager";
import { messageStore, type ChatMessage } from "./messageStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseRealtimeMessagesOptions {
  conversationId: string;
  /** Auto-connect on mount (default: true) */
  autoConnect?: boolean;
  /** Custom WS URL — falls back to env var */
  wsUrl?: string;
  /** Token getter for auth */
  getToken?: () => string | null;
  /** Called when an incoming message for THIS conversation arrives */
  onMessage?: (msg: ChatMessage) => void;
}

export interface UseRealtimeMessagesReturn {
  messages: readonly ChatMessage[];
  status: ConnectionStatus;
  queueLength: number;
  isOnline: boolean;
  sendMessage: (content: string, type?: ChatMessage["type"]) => ChatMessage | null;
  markRead: () => void;
  clearMessages: () => void;
  reconnect: () => void;
}

// ─── Per-URL singleton manager map ───────────────────────────────────────────

const _managers = new Map<string, WebSocketManager>();

function getOrCreateManager(url: string, getToken?: () => string | null): WebSocketManager {
  const existing = _managers.get(url);
  if (existing) return existing;

  const manager = new WebSocketManager({
    url,
    getToken,
    heartbeatIntervalMs: 30_000,
    maxReconnectAttempts: 10,
    reconnectBaseDelayMs: 1_000,
    reconnectMaxDelayMs: 30_000,
    onMessage: (msg: WsMessage) => {
      if (msg.type === "chat_message" || msg.type === "message") {
        messageStore.receiveMessage(msg as WsMessage<ChatMessage>);
      }
    },
    onStatusChange: (status: ConnectionStatus) => {
      messageStore.setConnectionStatus(status);
    },
  });

  // Give the store a reference to the send function
  messageStore.setSendFunction((type, payload) => manager.send(type, payload));
  _managers.set(url, manager);
  return manager;
}

// ─── Default WS URL ───────────────────────────────────────────────────────────

function resolveWsUrl(override?: string): string {
  if (override) return override;
  if (typeof window === "undefined") return "";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
  if (apiUrl) {
    // Convert http(s) to ws(s)
    return apiUrl.replace(/^https?/, (m) => (m === "https" ? "wss" : "ws")) + "/ws";
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/ws`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useRealtimeMessages({
  conversationId,
  autoConnect = true,
  wsUrl,
  getToken,
  onMessage,
}: UseRealtimeMessagesOptions): UseRealtimeMessagesReturn {
  const resolvedUrl = resolveWsUrl(wsUrl);
  const managerRef = useRef<WebSocketManager | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // useSyncExternalStore for React 18 concurrent-mode safe subscriptions
  const messages = useSyncExternalStore(
    (cb) => messageStore.subscribe(cb),
    () => messageStore.getMessages(conversationId),
    () => [] as readonly ChatMessage[],
  );

  const queueLength = useSyncExternalStore(
    (cb) => messageStore.subscribe(cb),
    () => messageStore.getQueue().length,
    () => 0,
  );

  const statusRaw = useSyncExternalStore(
    (cb) => messageStore.subscribe(cb),
    () => messageStore.getConnectionStatus(),
    () => "idle" as ConnectionStatus,
  );

  const isOnline = statusRaw === "connected";

  // Connect / disconnect lifecycle
  useEffect(() => {
    if (!resolvedUrl || typeof window === "undefined") return;

    const manager = getOrCreateManager(resolvedUrl, getToken);
    managerRef.current = manager;

    if (autoConnect) {
      manager.connect();
    }

    return () => {
      // Disconnect on unmount to prevent memory leaks
      // The manager is shared but should be cleaned up when no longer needed
      if (managerRef.current) {
        managerRef.current.disconnect();
      }
    };
  }, [resolvedUrl, autoConnect, getToken]);

  // Notify caller when relevant messages arrive
  useEffect(() => {
    if (!onMessageRef.current) return;
    const msgs = messageStore.getMessages(conversationId);
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg && !lastMsg.optimistic) {
      onMessageRef.current(lastMsg);
    }
  // We intentionally depend on the length to trigger when new messages arrive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, conversationId]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const sendMessage = useCallback(
    (content: string, type: ChatMessage["type"] = "text"): ChatMessage | null => {
      // Get current user identity from storage (set by AuthProvider)
      const userId = localStorage.getItem("user_id") ?? "anonymous";
      const userName = localStorage.getItem("user_name") ?? "Anonymous";

      if (!content.trim()) return null;

      return messageStore.sendMessage({
        conversationId,
        content: content.trim(),
        type,
        senderId: userId,
        senderName: userName,
      });
    },
    [conversationId],
  );

  const markRead = useCallback(() => {
    messageStore.markConversationRead(conversationId);
  }, [conversationId]);

  const clearMessages = useCallback(() => {
    messageStore.clearConversation(conversationId);
  }, [conversationId]);

  const reconnect = useCallback(() => {
    managerRef.current?.disconnect();
    managerRef.current?.connect();
  }, []);

  return {
    messages,
    status: statusRaw,
    queueLength,
    isOnline,
    sendMessage,
    markRead,
    clearMessages,
    reconnect,
  };
}

/** Convenience hook — only the connection status (no message subscription) */
export function useWsStatus(): ConnectionStatus {
  return useSyncExternalStore(
    (cb) => messageStore.subscribe(cb),
    () => messageStore.getConnectionStatus(),
    () => "idle" as ConnectionStatus,
  );
}

/** Convenience hook — total unread count across all conversations */
export function useTotalUnread(): number {
  return useSyncExternalStore(
    (cb) => messageStore.subscribe(cb),
    () => messageStore.getTotalUnread(),
    () => 0,
  );
}
