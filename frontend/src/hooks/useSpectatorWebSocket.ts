"use client";

/**
 * useSpectatorWebSocket — Issue #895
 *
 * Manages the WebSocket connection for spectators watching a live match.
 *
 * Features:
 * - Real-time match score / status updates for non-participants
 * - Live spectator count tracking
 * - Spectator chat message send / receive
 * - Exponential back-off reconnection (same pattern as useMatchWebSocket)
 * - Auth via httpOnly cookie on the WS upgrade request
 *
 * WebSocket endpoint: ws(s)://{host}/ws/match/{matchId}/spectate
 *
 * Inbound message types (from server):
 *   { type: "spectator_update",  ...SpectatorUpdate }
 *   { type: "chat_message",      ...SpectatorChatMessage }
 *   { type: "ping" }
 *
 * Outbound message types (to server):
 *   { type: "chat_message", content: string }
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SpectatorChatMessage,
  SpectatorConnectionStatus,
  SpectatorUpdate,
} from "@/types/match";
import type { BracketMatch } from "@/types/bracket";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_CHAT_MESSAGES = 200;

// ─── Hook options & return shape ─────────────────────────────────────────────

export interface UseSpectatorWebSocketOptions {
  matchId: string;
  /** Only open the socket when true (e.g. match is live). Default: true */
  enabled?: boolean;
  /** Called whenever a new chat message arrives from another spectator */
  onChatMessage?: (msg: SpectatorChatMessage) => void;
  /** Called whenever the live score / status changes */
  onMatchUpdate?: (update: SpectatorUpdate) => void;
}

export interface UseSpectatorWebSocketReturn {
  /** Current WS connection state */
  connectionStatus: SpectatorConnectionStatus;
  /** Shorthand: true when status === "connected" */
  isConnected: boolean;
  /** Most-recent match state update received from the server */
  lastUpdate: SpectatorUpdate | null;
  /** Running list of spectator chat messages (newest last) */
  chatMessages: SpectatorChatMessage[];
  /** Number of spectators currently watching (from server updates) */
  spectatorCount: number;
  /** Send a chat message — no-ops if not connected */
  sendChatMessage: (content: string, senderId: string, senderName: string) => void;
  /** Manually trigger a reconnect */
  reconnect: () => void;
  /** Human-readable error string when connection fails permanently */
  connectionError: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSpectatorWebSocket({
  matchId,
  enabled = true,
  onChatMessage,
  onMatchUpdate,
}: UseSpectatorWebSocketOptions): UseSpectatorWebSocketReturn {
  const [connectionStatus, setConnectionStatus] =
    useState<SpectatorConnectionStatus>("idle");
  const [lastUpdate, setLastUpdate] = useState<SpectatorUpdate | null>(null);
  const [chatMessages, setChatMessages] = useState<SpectatorChatMessage[]>([]);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const unmountedRef = useRef(false);

  // Stable refs for callbacks so effects don't stale-close over them
  const onChatMessageRef = useRef(onChatMessage);
  const onMatchUpdateRef = useRef(onMatchUpdate);
  onChatMessageRef.current = onChatMessage;
  onMatchUpdateRef.current = onMatchUpdate;

  // ── URL builder ───────────────────────────────────────────────────────────

  const buildWsUrl = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${window.location.host}/ws/match/${encodeURIComponent(matchId)}/spectate`;
  }, [matchId]);

  // ── Clear reconnect timer helper ──────────────────────────────────────────

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  // ── Disconnect ────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    retryCountRef.current = 0;
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close(1000, "Spectator disconnect");
      wsRef.current = null;
    }
    setConnectionStatus("disconnected");
    setConnectionError(null);
  }, []);

  // ── Connect ───────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (unmountedRef.current || !enabled || !matchId) return;

    // Tear down any existing socket before reconnecting
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionError(null);
    setConnectionStatus(retryCountRef.current > 0 ? "reconnecting" : "connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(buildWsUrl());
    } catch {
      setConnectionStatus("error");
      setConnectionError("Unable to open spectator feed connection.");
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (unmountedRef.current) {
        ws.close();
        return;
      }
      retryCountRef.current = 0;
      setConnectionStatus("connected");
      setConnectionError(null);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as {
          type: string;
          [key: string]: unknown;
        };

        if (data.type === "ping") return;

        if (data.type === "spectator_update") {
          const update: SpectatorUpdate = {
            matchId: data.matchId as string,
            spectatorCount: (data.spectatorCount as number) ?? 0,
            scorePlayer1: data.scorePlayer1 as number | undefined,
            scorePlayer2: data.scorePlayer2 as number | undefined,
            status: data.status as BracketMatch["status"] | undefined,
            winnerId: data.winnerId as string | undefined,
            eventMessage: data.eventMessage as string | undefined,
            timestamp: (data.timestamp as number) ?? Date.now(),
          };
          setLastUpdate(update);
          setSpectatorCount(update.spectatorCount);
          onMatchUpdateRef.current?.(update);
          return;
        }

        if (data.type === "chat_message") {
          const msg: SpectatorChatMessage = {
            id: (data.id as string) ?? `${Date.now()}-${Math.random()}`,
            senderId: data.senderId as string,
            senderName: (data.senderName as string) ?? "Spectator",
            content: data.content as string,
            createdAt: (data.createdAt as number) ?? Date.now(),
          };
          setChatMessages((prev) => {
            const next = [...prev, msg];
            // Cap the in-memory list to avoid unbounded growth
            return next.length > MAX_CHAT_MESSAGES
              ? next.slice(next.length - MAX_CHAT_MESSAGES)
              : next;
          });
          onChatMessageRef.current?.(msg);
        }
      } catch {
        // Ignore malformed frames
      }
    };

    ws.onclose = (event: CloseEvent) => {
      wsRef.current = null;
      if (unmountedRef.current) return;

      // Auth failures — stop retrying
      const AUTH_FAILURE_CODES = [1008, 4401, 4403];
      if (AUTH_FAILURE_CODES.includes(event.code)) {
        setConnectionStatus("error");
        setConnectionError("Authentication failed. Please refresh the page.");
        return;
      }

      // Graceful close — no reconnect
      if (event.code === 1000) {
        setConnectionStatus("disconnected");
        return;
      }

      // Transient failure — exponential back-off
      setConnectionStatus("reconnecting");
      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        1_000 * Math.pow(2, retryCountRef.current),
      );
      retryCountRef.current += 1;
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose fires right after onerror; reconnect logic lives there
      ws.close();
    };
  }, [buildWsUrl, enabled, matchId]);

  // ── Public reconnect ──────────────────────────────────────────────────────

  const reconnect = useCallback(() => {
    clearReconnectTimer();
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    unmountedRef.current = false;

    if (enabled && matchId) {
      connect();
    }

    return () => {
      unmountedRef.current = true;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, enabled]);

  // ── Dev simulation ────────────────────────────────────────────────────────
  // Stripped out of the production bundle via dead-code elimination.

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!enabled || !matchId || connectionStatus !== "connected") return;

    const timer = setTimeout(() => {
      setLastUpdate({
        matchId,
        spectatorCount: 42,
        scorePlayer1: 1,
        scorePlayer2: 0,
        status: "in_progress",
        eventMessage: "[dev] Spectator feed connected.",
        timestamp: Date.now(),
      });
      setSpectatorCount(42);
    }, 2_000);

    return () => clearTimeout(timer);
  }, [enabled, matchId, connectionStatus]);

  // ── Send chat message ─────────────────────────────────────────────────────

  const sendChatMessage = useCallback(
    (content: string, senderId: string, senderName: string) => {
      const trimmed = content.trim();
      if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        return;
      }

      // Optimistic insert
      const optimisticMsg: SpectatorChatMessage = {
        id: `optimistic-${Date.now()}-${Math.random()}`,
        senderId,
        senderName,
        content: trimmed,
        createdAt: Date.now(),
        optimistic: true,
      };

      setChatMessages((prev) => {
        const next = [...prev, optimisticMsg];
        return next.length > MAX_CHAT_MESSAGES
          ? next.slice(next.length - MAX_CHAT_MESSAGES)
          : next;
      });

      try {
        wsRef.current.send(
          JSON.stringify({ type: "chat_message", content: trimmed }),
        );
      } catch {
        // Remove the optimistic message on send failure
        setChatMessages((prev) =>
          prev.filter((m) => m.id !== optimisticMsg.id),
        );
      }
    },
    [],
  );

  return {
    connectionStatus,
    isConnected: connectionStatus === "connected",
    lastUpdate,
    chatMessages,
    spectatorCount,
    sendChatMessage,
    reconnect,
    connectionError,
  };
}
