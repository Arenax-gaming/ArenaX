"use client";

/**
 * useMatchmakingQueue — REST queue membership + live WebSocket status (#1216).
 *
 * Flow:
 *  1. On mount the player is added to the queue through `POST /matchmaking/join`.
 *  2. A WebSocket to `/ws` (the shared user channel) delivers `queue_status_update`
 *     events pushed by the backend on join/leave/match.
 *  3. A slow REST poll (`/matchmaking/status/...`) keeps the displayed position
 *     fresh as other players join or leave.
 *  4. On disconnect the socket reconnects with exponential back-off.
 *
 * Authentication rides on the httpOnly `auth_token` cookie, exactly like the
 * other realtime hooks — no token is placed in the URL.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

export interface QueueStatusEvent {
  type: "queue_status_update";
  game: string;
  game_mode: string;
  status: "waiting" | "matched" | "left";
  position?: number | null;
  queue_size: number;
  estimated_wait_time?: number | null;
  wait_time_so_far?: number | null;
  match_id?: string | null;
  timestamp: string;
}

interface UseMatchmakingQueueOptions {
  game: string;
  gameMode: string;
  enabled?: boolean;
  /** Called once when the backend reports a found match. */
  onMatchFound?: (matchId: string) => void;
}

export interface UseMatchmakingQueueReturn {
  position: number | null;
  queueSize: number;
  estimatedWaitTime: number | null;
  waitTime: number;
  isSearching: boolean;
  isConnected: boolean;
  isReconnecting: boolean;
  connectionError: string | null;
  matchId: string | null;
  leaveQueue: () => Promise<void>;
  reconnect: () => void;
}

const INITIAL_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;
const STATUS_POLL_INTERVAL_MS = 10_000;

export function useMatchmakingQueue({
  game,
  gameMode,
  enabled = true,
  onMatchFound,
}: UseMatchmakingQueueOptions): UseMatchmakingQueueReturn {
  const [position, setPosition] = useState<number | null>(null);
  const [queueSize, setQueueSize] = useState(0);
  const [estimatedWaitTime, setEstimatedWaitTime] = useState<number | null>(null);
  const [waitTime, setWaitTime] = useState(0);
  const [isSearching, setIsSearching] = useState(enabled);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const closedRef = useRef(false);
  const matchedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onMatchFoundRef = useRef(onMatchFound);
  onMatchFoundRef.current = onMatchFound;

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const connect = useCallback(() => {
    if (closedRef.current || !enabled) return;

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionError(null);

    let socket: WebSocket;
    try {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
    } catch {
      setConnectionError("Unable to open the queue connection.");
      return;
    }

    wsRef.current = socket;

    socket.onopen = () => {
      if (closedRef.current) {
        socket.close();
        return;
      }
      retryCountRef.current = 0;
      setIsConnected(true);
      setIsReconnecting(false);
      setConnectionError(null);
    };

    socket.onmessage = (event) => {
      let payload: { event?: QueueStatusEvent } | QueueStatusEvent;
      try {
        payload = JSON.parse(event.data as string);
      } catch {
        return;
      }

      const update = "event" in payload && payload.event ? payload.event : (payload as QueueStatusEvent);
      if (!update || update.type !== "queue_status_update") return;
      // Ignore updates for a different queue than the one this hook owns.
      if (update.game !== game || update.game_mode !== gameMode) return;

      if (typeof update.position === "number") setPosition(update.position);
      if (typeof update.queue_size === "number") setQueueSize(update.queue_size);
      if (typeof update.estimated_wait_time === "number") {
        setEstimatedWaitTime(update.estimated_wait_time);
      }
      if (typeof update.wait_time_so_far === "number") setWaitTime(update.wait_time_so_far);

      if (update.status === "matched" && update.match_id && !matchedRef.current) {
        matchedRef.current = true;
        setIsSearching(false);
        setMatchId(update.match_id);
        onMatchFoundRef.current?.(update.match_id);
      }
      if (update.status === "left") {
        setIsSearching(false);
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
      if (closedRef.current || matchedRef.current) return;

      if (retryCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setConnectionError(
          "Lost connection to the matchmaking service. Your queue spot is preserved.",
        );
        setIsReconnecting(false);
        return;
      }

      const delay = Math.min(
        INITIAL_RECONNECT_DELAY_MS * 2 ** retryCountRef.current,
        MAX_RECONNECT_DELAY_MS,
      );
      retryCountRef.current += 1;
      setIsReconnecting(true);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    socket.onerror = () => {
      // `onclose` owns the retry decision; just surface the state.
      setConnectionError("Queue connection interrupted.");
    };
  }, [enabled, game, gameMode]);

  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    clearReconnectTimer();
    connect();
  }, [connect]);

  useEffect(() => {
    if (!enabled || !game || !gameMode) return;

    closedRef.current = false;
    matchedRef.current = false;
    setIsSearching(true);

    let cancelled = false;

    // Join once; the WebSocket only carries updates.
    void (async () => {
      try {
        const response = await api.joinMatchmaking(game, gameMode);
        if (cancelled) return;
        if (typeof response.queue_position === "number") setPosition(response.queue_position);
        if (typeof response.estimated_wait_time === "number") {
          setEstimatedWaitTime(response.estimated_wait_time);
        }
        if (!response.success) {
          setConnectionError(response.message || "Unable to join the queue.");
          setIsSearching(false);
        }
      } catch (error) {
        if (cancelled) return;
        setConnectionError(
          error instanceof Error ? error.message : "Unable to join the queue.",
        );
        setIsSearching(false);
      }
    })();

    connect();

    const tickTimer = setInterval(() => setWaitTime((seconds) => seconds + 1), 1000);
    pollTimerRef.current = setInterval(() => {
      void (async () => {
        try {
          const status = await api.getMatchmakingStatus(game, gameMode);
          if (cancelled) return;
          if (!status.in_queue) {
            setPosition(null);
            return;
          }
          setQueueSize(status.queue_size);
          if (typeof status.estimated_wait_time === "number") {
            setEstimatedWaitTime(status.estimated_wait_time);
          }
        } catch {
          // Polling is a freshness fallback; a failed poll must not tear down
          // the socket or show an error over a transient blip.
        }
      })();
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      closedRef.current = true;
      clearReconnectTimer();
      clearInterval(tickTimer);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);

      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }

      // Leaving is deliberate only when the player was still searching. Once a
      // match is found the component unmounts during navigation and the spot
      // must NOT be cancelled.
      if (!matchedRef.current) {
        void api.leaveMatchmaking(game, gameMode).catch(() => {});
      }
    };
  }, [enabled, game, gameMode, connect]);

  const leaveQueue = useCallback(async () => {
    matchedRef.current = true; // prevent the unmount handler from leaving twice
    setIsSearching(false);
    setPosition(null);
    try {
      await api.leaveMatchmaking(game, gameMode);
    } finally {
      closedRef.current = true;
      clearReconnectTimer();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setIsConnected(false);
    }
  }, [game, gameMode]);

  return {
    position,
    queueSize,
    estimatedWaitTime,
    waitTime,
    isSearching,
    isConnected,
    isReconnecting,
    connectionError,
    matchId,
    leaveQueue,
    reconnect,
  };
}
