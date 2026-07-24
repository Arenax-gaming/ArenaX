"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CollaborationChannel,
  CollaborationEvent,
  CollaborationServerMessage,
} from "@/types/collaboration";
import {
  CollaborationChannelType,
  CollaborationEventType,
} from "@/types/collaboration";

interface UseCollaborationWebSocketOptions {
  channelId?: string;
  channelType?: CollaborationChannelType;
  enabled?: boolean;
}

interface UseCollaborationWebSocketReturn {
  isConnected: boolean;
  channel: CollaborationChannel | null;
  events: CollaborationEvent[];
  sendEvent: (event: Omit<CollaborationEvent, "timestamp" | "userId">) => void;
  connectionError: string | null;
  reconnect: () => void;
  disconnect: () => void;
}

const MAX_EVENTS = 50;
const MAX_RECONNECT_DELAY_MS = 10_000;
const TOURNAMENT_CHANNEL_PREFIX = "tournament-";

const KNOWN_EVENT_TYPES = new Set<string>(
  Object.values(CollaborationEventType)
);

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    localStorage.getItem("auth_token") ?? sessionStorage.getItem("auth_token")
  );
}

/**
 * The CollaborationProvider is mounted outside the AuthProvider, so the
 * current user id is read from the persisted session instead of useAuth().
 */
function getStoredUserId(): string | null {
  if (typeof window === "undefined") return null;
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const stored = storage.getItem("arenax_auth_user");
      if (!stored) continue;
      const parsed = JSON.parse(stored) as { id?: unknown };
      if (typeof parsed.id === "string") return parsed.id;
    } catch {
      // Ignore malformed stored sessions
    }
  }
  return null;
}

function buildWsUrl(channelId: string, channelType: CollaborationChannelType) {
  // Co-view channel ids are "tournament-{tournamentId}"; the server route is
  // keyed by the tournament id itself.
  const resourceId =
    channelType === CollaborationChannelType.TOURNAMENT_COVIEW &&
    channelId.startsWith(TOURNAMENT_CHANNEL_PREFIX)
      ? channelId.slice(TOURNAMENT_CHANNEL_PREFIX.length)
      : channelId;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const token = getAuthToken();
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${protocol}://${window.location.host}/ws/collaboration/${encodeURIComponent(resourceId)}${qs}`;
}

function parseServerMessage(raw: unknown): CollaborationServerMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    if (typeof parsed?.type !== "string") return null;
    if (
      parsed.type === "ping" ||
      parsed.type === "channel_state" ||
      KNOWN_EVENT_TYPES.has(parsed.type)
    ) {
      return parsed as CollaborationServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}

function applyEventToChannel(
  channel: CollaborationChannel | null,
  event: CollaborationEvent
): CollaborationChannel | null {
  if (!channel || event.channelId !== channel.id) return channel;

  switch (event.type) {
    case CollaborationEventType.USER_JOINED:
      if (channel.users.some((u) => u.id === event.user.id)) return channel;
      return { ...channel, users: [...channel.users, event.user] };
    case CollaborationEventType.USER_LEFT:
      return {
        ...channel,
        users: channel.users.filter((u) => u.id !== event.userId),
      };
    case CollaborationEventType.READY_CHANGED:
      return {
        ...channel,
        users: channel.users.map((u) =>
          u.id === event.userId ? { ...u, isReady: event.isReady } : u
        ),
      };
    default:
      return channel;
  }
}

function appendEvent(
  prev: CollaborationEvent[],
  event: CollaborationEvent
): CollaborationEvent[] {
  // The server echoes messages back to the sender; skip echoes of
  // optimistically-appended messages.
  if (
    event.type === CollaborationEventType.MESSAGE &&
    prev.some(
      (e) =>
        e.type === CollaborationEventType.MESSAGE &&
        e.messageId === event.messageId
    )
  ) {
    return prev;
  }
  return [event, ...prev].slice(0, MAX_EVENTS);
}

export function useCollaborationWebSocket({
  channelId,
  channelType,
  enabled = true,
}: UseCollaborationWebSocketOptions): UseCollaborationWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [channel, setChannel] = useState<CollaborationChannel | null>(null);
  const [events, setEvents] = useState<CollaborationEvent[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [connectionNonce, setConnectionNonce] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // A manual disconnect() only suspends the current channel session.
  useEffect(() => {
    setSuspended(false);
  }, [channelId, channelType]);

  useEffect(() => {
    if (!enabled || !channelId || !channelType || suspended) {
      setIsConnected(false);
      setChannel(null);
      return;
    }
    if (typeof window === "undefined") return;

    let closed = false;
    let retry = 0;

    const handleMessage = (raw: unknown) => {
      const message = parseServerMessage(raw);
      if (!message) return;

      if (message.type === "ping") {
        wsRef.current?.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (message.type === "channel_state") {
        setChannel(message.channel);
        return;
      }
      setEvents((prev) => appendEvent(prev, message));
      setChannel((prev) => applyEventToChannel(prev, message));
    };

    const scheduleReconnect = () => {
      if (closed) return;
      const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** retry);
      retry += 1;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    const connect = () => {
      if (closed) return;

      let ws: WebSocket;
      try {
        ws = new WebSocket(buildWsUrl(channelId, channelType));
      } catch {
        setConnectionError("Unable to open collaboration connection");
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setIsConnected(true);
        setConnectionError(null);
      };
      ws.onmessage = (event) => handleMessage(event.data);
      ws.onclose = () => {
        if (closed) return;
        setIsConnected(false);
        setConnectionError("Collaboration connection lost. Reconnecting...");
        scheduleReconnect();
      };
      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      setIsConnected(false);
      setChannel(null);
      setEvents([]);
      setConnectionError(null);
    };
  }, [channelId, channelType, enabled, suspended, connectionNonce]);

  const disconnect = useCallback(() => {
    setSuspended(true);
  }, []);

  const reconnect = useCallback(() => {
    setSuspended(false);
    setConnectionNonce((nonce) => nonce + 1);
  }, []);

  const sendEvent = useCallback(
    (event: Omit<CollaborationEvent, "timestamp" | "userId">) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const fullEvent = {
        ...event,
        timestamp: Date.now(),
        userId: getStoredUserId() ?? "",
      } as CollaborationEvent;

      ws.send(JSON.stringify(fullEvent));
      // Optimistic append; the server echo is deduped in appendEvent.
      setEvents((prev) => appendEvent(prev, fullEvent));
    },
    []
  );

  return {
    isConnected,
    channel,
    events,
    sendEvent,
    connectionError,
    reconnect,
    disconnect,
  };
}
