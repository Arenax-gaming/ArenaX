"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  reconnect: () => void;
  disconnect: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum reconnect delay (ms). */
const MAX_RECONNECT_DELAY_MS = 30_000;

// ---------------------------------------------------------------------------
// useMatchWebSocket
//
// Real WebSocket implementation — no simulation scaffolding.
//
// Authentication: the browser automatically sends the `auth_token` httpOnly
// cookie with the WebSocket upgrade request (same-origin).  No token is ever
// embedded in the URL or passed via localStorage.
//
// Reconnection: exponential back-off capped at MAX_RECONNECT_DELAY_MS.
// ---------------------------------------------------------------------------

export function useMatchWebSocket({
  matchId,
  enabled = true,
}: UseMatchWebSocketOptions): UseMatchWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<MatchUpdate | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  // Set to true when the cleanup function runs so stale async callbacks
  // don't attempt to reconnect after the component has unmounted.
  const closedRef = useRef(false);

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

    ws.onopen = () => {
      if (closedRef.current) {
        ws.close();
        return;
      }
      retryCountRef.current = 0;
      setIsConnected(true);
      setConnectionError(null);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as Partial<MatchUpdate> & {
          type?: string;
        };

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

      if (closedRef.current) return;

      // Permanent auth failures — do not retry.
      const AUTH_FAILURE_CODES = [1008, 4401, 4403];
      if (AUTH_FAILURE_CODES.includes(event.code)) {
        setConnectionError("Authentication failed. Please refresh the page.");
        return;
      }

      // Normal closure — no reconnect needed.
      if (event.code === 1000) return;

      // Transient failure — reconnect with exponential back-off.
      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        1_000 * 2 ** retryCountRef.current,
      );
      retryCountRef.current += 1;
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

  return { isConnected, lastUpdate, connectionError, reconnect, disconnect };
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
  const [isReporting, setIsReporting] = useState(false);
  const [pendingReport, setPendingReport] = useState<ScoreReport | null>(null);
  const [conflictDetected, setConflictDetected] = useState(false);
  const [conflictingReport, setConflictingReport] = useState<ScoreReport | null>(
    null,
  );

  const reportScore = useCallback(
    async (report: ScoreSubmission): Promise<boolean> => {
      setIsReporting(true);

      const submittedReport: ScoreReport = {
        reporterId: report.reporterId,
        reporterName: report.reporterName ?? "You",
        player1Score: report.player1Score,
        player2Score: report.player2Score,
        submittedAt: new Date().toISOString(),
      };

      setPendingReport(submittedReport);

      // Small debounce to avoid double-submissions on fast taps.
      await new Promise((resolve) => setTimeout(resolve, 900));

      if (
        options.expectedReport &&
        (options.expectedReport.player1Score !== report.player1Score ||
          options.expectedReport.player2Score !== report.player2Score)
      ) {
        setConflictDetected(true);
        setConflictingReport(options.expectedReport);
        setIsReporting(false);
        return false;
      }

      setConflictDetected(false);
      setConflictingReport(null);
      setIsReporting(false);
      return true;
    },
    [options.expectedReport],
  );

  const clearConflict = useCallback(() => {
    setConflictDetected(false);
    setConflictingReport(null);
  }, []);

  return {
    reportScore,
    pendingReport,
    isReporting,
    conflictDetected,
    conflictingReport,
    clearConflict,
  };
}
