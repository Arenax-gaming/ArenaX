"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  CollaborationChannel,
  CollaborationEvent,
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

export function useCollaborationWebSocket({
  channelId,
  channelType,
  enabled = true,
}: UseCollaborationWebSocketOptions): UseCollaborationWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [channel, setChannel] = useState<CollaborationChannel | null>(null);
  const [events, setEvents] = useState<CollaborationEvent[]>([]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const closedRef = useRef(false);

  const disconnect = useCallback(() => {
    closedRef.current = true;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    setIsConnected(false);
    setChannel(null);
    setEvents([]);
  }, []);

  const connect = useCallback(() => {
    if (!enabled || !channelId || !channelType) {
      return;
    }

    closedRef.current = false;

    // TODO: Replace with real WebSocket URL once the collaboration backend is ready.
    // const wsUrl = `${process.env.NEXT_PUBLIC_WS_BASE_URL}/collaboration/${channelId}`;
    // const ws = new WebSocket(wsUrl);
    // wsRef.current = ws;
    //
    // ws.onopen = () => { ... };
    // ws.onmessage = (event) => { ... };
    // ws.onclose = () => { ... };
    // ws.onerror = () => { ... };
    //
    // Until the backend is available the hook stays in an idle (not connected) state
    // so the UI shows the empty/invite state rather than fake activity.
  }, [enabled, channelId, channelType]);

  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [connect, disconnect]);

  const sendEvent = useCallback(
    (event: Omit<CollaborationEvent, "timestamp" | "userId">) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      // Events are only dispatched over a real WebSocket connection.
      // When the backend is wired up, serialise and send here:
      // wsRef.current.send(JSON.stringify({ ...event, timestamp: Date.now() }));
    },
    []
  );

  useEffect(() => {
    if (enabled && channelId) {
      connect();
      return () => {
        disconnect();
      };
    }
    disconnect();
  }, [connect, disconnect, enabled, channelId]);

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
