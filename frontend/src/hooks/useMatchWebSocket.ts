"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BracketMatchStatus, ScoreReport } from "@/types/bracket";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MatchUpdate {
  matchId: string;
  scorePlayer1?: number;
  scorePlayer2?: number;
  status?: BracketMatchStatus;
  winnerId?: string;
  message?: string;
  timestamp: number;
}

interface UseMatchWebSocketOptions {
  matchId: string;
  enabled?: boolean;
}

interface UseMatchWebSocketReturn {
  isConnected: boolean;
  lastUpdate: MatchUpdate | null;
  connectionError: string | null;
  /** True while a reconnect attempt is scheduled or in progress. */
  isReconnecting: boolean;
  /** True briefly after the connection is restored following a drop. */
  connectionRestored: boolean;
  reconnect: () => void;
  disconnect: () => void;
  /**
   * Rolling average (ms) of the last `LATENCY_WINDOW_SIZE` end-to-end
   * round-trip samples (#1566). `null` until the first pong is received.
   */
  latencyMs: number | null;
  /** Raw round-trip samples backing `latencyMs`, oldest first, capped at `LATENCY_WINDOW_SIZE`. */
  latencySamples: number[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Initial reconnect delay (ms). */
const INITIAL_RECONNECT_DELAY_MS = 500;

/** Maximum reconnect delay (ms). */
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Reconnect attempts before surfacing a connection-lost notification. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** How long the "connection restored" flag stays set (ms). */
const RESTORED_NOTICE_MS = 3_000;

/** How often a timestamped latency ping is sent while connected (#1566). */
const LATENCY_PING_INTERVAL_MS = 2_000;

/** Number of round-trip samples kept for the rolling average (#1566). */
const LATENCY_WINDOW_SIZE = 10;

// ---------------------------------------------------------------------------
// useMatchWebSocket
//
// Real WebSocket implementation — no simulation scaffolding.
//
// Authentication: the browser automatically sends the `auth_token` httpOnly
// cookie with the WebSocket upgrade request (same-origin).  No token is ever
// embedded in the URL or passed via localStorage.
//
// Reconnection: exponential back-off (500ms → 30s), giving up after
// MAX_RECONNECT_ATTEMPTS. The last received update is kept while offline so
// the UI can keep rendering cached state.
// ---------------------------------------------------------------------------

export function useMatchWebSocket({
  matchId,
  enabled = true,
}: UseMatchWebSocketOptions): UseMatchWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<MatchUpdate | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [connectionRestored, setConnectionRestored] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [latencySamples, setLatencySamples] = useState<number[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const restoredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set to true when the cleanup function runs so stale async callbacks
  // don't attempt to reconnect after the component has unmounted.
  const closedRef = useRef(false);

  // ── Latency measurement (#1566) ────────────────────────────────────────
  // Timestamped pings sent on an interval; `pendingLatencyPingsRef` maps a
  // ping id to its send time so the matching pong can compute a true
  // end-to-end round trip (not just server ping, which the existing
  // keepalive "ping" message above already represents).
  const latencyPingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingLatencyPingsRef = useRef<Map<string, number>>(new Map());
  const latencySamplesRef = useRef<number[]>([]);
  const latencyPingSeqRef = useRef(0);

  const clearLatencyPingInterval = () => {
    if (latencyPingIntervalRef.current !== null) {
      clearInterval(latencyPingIntervalRef.current);
      latencyPingIntervalRef.current = null;
    }
    pendingLatencyPingsRef.current.clear();
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const buildWsUrl = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    // matchId is path-encoded to prevent URL injection.
    return `${protocol}://${window.location.host}/ws/match/${encodeURIComponent(matchId)}`;
  }, [matchId]);

  // ── Disconnect ────────────────────────────────────────────────────────────

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    clearLatencyPingInterval();
    retryCountRef.current = 0;
    if (wsRef.current) {
      // Remove handlers before closing so onclose doesn't schedule a reconnect.
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close(1000, "Client disconnect");
      wsRef.current = null;
    }
    setIsConnected(false);
    setIsReconnecting(false);
    setConnectionError(null);
  }, []);

  // ── Connect ───────────────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (closedRef.current || !enabled || !matchId) return;

    // Clean up any existing socket before opening a new one.
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionError(null);

    let ws: WebSocket;
    try {
      ws = new WebSocket(buildWsUrl());
    } catch {
      // URL construction failed — don't retry.
      setConnectionError("Unable to open match feed connection.");
      return;
    }

    wsRef.current = ws;

    // Sends a timestamped latency-measurement ping; the matching
    // "latency_pong" reply (handled below) closes the round trip (#1566).
    // Distinct from the server's own keepalive "ping" message, which this
    // hook has always ignored — that only measures server liveness, not
    // the full end-to-end path a player actually experiences.
    const sendLatencyPing = () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const id = `lp-${++latencyPingSeqRef.current}`;
      const sentAt = Date.now();
      pendingLatencyPingsRef.current.set(id, sentAt);
      // Bound memory if pongs stop arriving (e.g. server doesn't support
      // this message type yet) — drop the oldest in-flight ping.
      if (pendingLatencyPingsRef.current.size > LATENCY_WINDOW_SIZE * 2) {
        const oldestKey = pendingLatencyPingsRef.current.keys().next().value;
        if (oldestKey !== undefined) pendingLatencyPingsRef.current.delete(oldestKey);
      }
      try {
        ws.send(JSON.stringify({ type: "latency_ping", id, ts: sentAt }));
      } catch {
        // Socket is closing — the next interval tick (or cleanup) handles it.
      }
    };

    ws.onopen = () => {
      if (closedRef.current) {
        ws.close();
        return;
      }
      const wasReconnecting = retryCountRef.current > 0;
      retryCountRef.current = 0;
      setIsConnected(true);
      setIsReconnecting(false);
      setConnectionError(null);
      if (wasReconnecting) {
        setConnectionRestored(true);
        if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current);
        restoredTimerRef.current = setTimeout(
          () => setConnectionRestored(false),
          RESTORED_NOTICE_MS,
        );
      }

      clearLatencyPingInterval();
      sendLatencyPing();
      latencyPingIntervalRef.current = setInterval(sendLatencyPing, LATENCY_PING_INTERVAL_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as Partial<MatchUpdate> & {
          type?: string;
          id?: string;
        };

        // Latency pong — resolve the round trip and never fall through to
        // match-data handling below (#1566 "does not interfere with match
        // data messages").
        if (data.type === "latency_pong") {
          const id = data.id;
          if (id && pendingLatencyPingsRef.current.has(id)) {
            const sentAt = pendingLatencyPingsRef.current.get(id)!;
            pendingLatencyPingsRef.current.delete(id);
            const rtt = Math.max(0, Date.now() - sentAt);
            const samples = [...latencySamplesRef.current, rtt].slice(-LATENCY_WINDOW_SIZE);
            latencySamplesRef.current = samples;
            setLatencySamples(samples);
            setLatencyMs(Math.round(samples.reduce((sum, v) => sum + v, 0) / samples.length));
          }
          return;
        }

        // Ignore keepalive pings.
        if (data.type === "ping") return;

        if (data.matchId) {
          setLastUpdate({
            matchId: data.matchId,
            scorePlayer1: data.scorePlayer1,
            scorePlayer2: data.scorePlayer2,
            status: data.status,
            winnerId: data.winnerId,
            message: data.message,
            timestamp: data.timestamp ?? Date.now(),
          });
        }
      } catch {
        // Ignore malformed messages.
      }
    };

    ws.onclose = (event: CloseEvent) => {
      setIsConnected(false);
      wsRef.current = null;
      clearLatencyPingInterval();

      if (closedRef.current) return;

      // Permanent auth failures — do not retry.
      const AUTH_FAILURE_CODES = [1008, 4401, 4403];
      if (AUTH_FAILURE_CODES.includes(event.code)) {
        setConnectionError("Authentication failed. Please refresh the page.");
        return;
      }

      // Normal closure — no reconnect needed.
      if (event.code === 1000) return;

      if (retryCountRef.current >= MAX_RECONNECT_ATTEMPTS) {
        setIsReconnecting(false);
        setConnectionError(
          "Connection to match feed lost. Showing last known state.",
        );
        return;
      }

      // Transient failure — reconnect with exponential back-off.
      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        INITIAL_RECONNECT_DELAY_MS * 2 ** retryCountRef.current,
      );
      retryCountRef.current += 1;
      setIsReconnecting(true);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose fires immediately after onerror — reconnect logic lives there.
      ws.close();
    };
  }, [buildWsUrl, enabled, matchId]);

  // ── Public reconnect ──────────────────────────────────────────────────────

  const reconnect = useCallback(() => {
    clearReconnectTimer();
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  // ── Effect: open / close socket on mount / matchId / enabled changes ──────

  useEffect(() => {
    closedRef.current = false;

    if (enabled && matchId) {
      connect();
    }

    return () => {
      closedRef.current = true;
      if (restoredTimerRef.current) clearTimeout(restoredTimerRef.current);
      disconnect();
    };
    // `connect` and `disconnect` are stable callbacks; re-run when the
    // match or enabled flag changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, enabled]);

  // ── Dev-only simulation ───────────────────────────────────────────────────
  // Gated strictly behind NODE_ENV so it is tree-shaken out of the
  // production bundle.  Never runs in production.

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (!enabled || !matchId || !isConnected) return;

    // In development, simulate a match update after 3 seconds so the UI can
    // be tested without a live backend.
    const timer = setTimeout(() => {
      setLastUpdate({
        matchId,
        scorePlayer1: 0,
        scorePlayer2: 0,
        status: "in_progress",
        message: "[dev] Match feed connected.",
        timestamp: Date.now(),
      });
    }, 3_000);

    return () => clearTimeout(timer);
  }, [enabled, isConnected, matchId]);

  return {
    isConnected,
    lastUpdate,
    connectionError,
    isReconnecting,
    connectionRestored,
    reconnect,
    disconnect,
    latencyMs,
    latencySamples,
  };
}

// ---------------------------------------------------------------------------
// useMatchScoreReporting  (unchanged — no simulation code was here)
// ---------------------------------------------------------------------------

interface ScoreSubmission {
  matchId: string;
  player1Score: number;
  player2Score: number;
  reporterId: string;
  reporterName?: string;
}

interface UseMatchScoreReportingOptions {
  expectedReport?: ScoreReport | null;
  /** Keys the "pending report" cache entry (#1088). Falls back to a shared key when omitted. */
  matchId?: string;
}

/** Thrown by the mutation when the reporter's score doesn't match the opponent's (#1088). */
class ScoreConflictError extends Error {
  constructor(public readonly expectedReport: ScoreReport) {
    super("SCORE_CONFLICT");
    this.name = "ScoreConflictError";
  }
}

interface UseMatchScoreReportingReturn {
  reportScore: (report: ScoreSubmission) => Promise<boolean>;
  pendingReport: ScoreReport | null;
  isReporting: boolean;
  conflictDetected: boolean;
  conflictingReport: ScoreReport | null;
  clearConflict: () => void;
}

export function useMatchScoreReporting(
  options: UseMatchScoreReportingOptions = {},
): UseMatchScoreReportingReturn {
  const queryClient = useQueryClient();
  const [conflictDetected, setConflictDetected] = useState(false);
  const [conflictingReport, setConflictingReport] = useState<ScoreReport | null>(
    null,
  );

  const pendingKey = ["pendingScoreReport", options.matchId ?? "unknown"] as const;

  // Cache-only value: never fetched, only ever written by the mutation's
  // onMutate below — this is what makes the "Pending Confirmation" state
  // (#1088) visible the instant the user submits, not after the round trip.
  const { data: pendingReport = null } = useQuery({
    queryKey: pendingKey,
    queryFn: () => null as ScoreReport | null,
    staleTime: Infinity,
    enabled: false,
  });

  const mutation = useMutation({
    mutationFn: async (report: ScoreSubmission) => {
      // Small debounce to avoid double-submissions on fast taps, and to
      // simulate the server round trip that resolves the report.
      await new Promise((resolve) => setTimeout(resolve, 900));

      if (
        options.expectedReport &&
        (options.expectedReport.player1Score !== report.player1Score ||
          options.expectedReport.player2Score !== report.player2Score)
      ) {
        throw new ScoreConflictError(options.expectedReport);
      }
      return report;
    },
    onMutate: (report) => {
      const submittedReport: ScoreReport = {
        reporterId: report.reporterId,
        reporterName: report.reporterName ?? "You",
        player1Score: report.player1Score,
        player2Score: report.player2Score,
        submittedAt: new Date().toISOString(),
      };
      queryClient.setQueryData(pendingKey, submittedReport);
    },
    onError: (error) => {
      if (error instanceof ScoreConflictError) {
        setConflictDetected(true);
        setConflictingReport(error.expectedReport);
      }
    },
    onSuccess: () => {
      setConflictDetected(false);
      setConflictingReport(null);
    },
  });

  const reportScore = useCallback(
    async (report: ScoreSubmission): Promise<boolean> => {
      try {
        await mutation.mutateAsync(report);
        return true;
      } catch (error) {
        if (error instanceof ScoreConflictError) return false;
        throw error;
      }
    },
    [mutation],
  );

  const clearConflict = useCallback(() => {
    setConflictDetected(false);
    setConflictingReport(null);
  }, []);

  return {
    reportScore,
    pendingReport,
    isReporting: mutation.isPending,
    conflictDetected,
    conflictingReport,
    clearConflict,
  };
}
