"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BracketMatchStatus, ScoreReport } from "@/types/bracket";

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

const scriptedUpdates: Record<string, MatchUpdate[]> = {
  "1-match-13": [
    {
      matchId: "1-match-13",
      scorePlayer1: 1,
      scorePlayer2: 1,
      status: "in_progress",
      message: "Map three has started.",
      timestamp: 1,
    },
    {
      matchId: "1-match-13",
      scorePlayer1: 2,
      scorePlayer2: 1,
      status: "completed",
      winnerId: "user-123",
      message: "ProGamer99 closed the semifinal and locked a finals berth.",
      timestamp: 2,
    },
  ],
  "2-match-10": [
    {
      matchId: "2-match-10",
      scorePlayer1: 1,
      scorePlayer2: 1,
      status: "disputed",
      message: "Conflicting score reports detected.",
      timestamp: 1,
    },
  ],
};

export function useMatchWebSocket({
  matchId,
  enabled = true,
}: UseMatchWebSocketOptions): UseMatchWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<MatchUpdate | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateIndexRef = useRef(0);

  const updates = useMemo(
    () => scriptedUpdates[matchId] ?? [],
    [matchId],
  );

  const disconnect = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    updateIndexRef.current = 0;
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    setConnectionError(null);
    setLastUpdate(null);

    const connectTimeout = setTimeout(() => {
      setIsConnected(true);

      if (!enabled || updates.length === 0) {
        return;
      }

      intervalRef.current = setInterval(() => {
        const nextUpdate = updates[updateIndexRef.current];
        if (!nextUpdate) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return;
        }

        setLastUpdate({
          ...nextUpdate,
          timestamp: Date.now(),
        });
        updateIndexRef.current += 1;
      }, 4500);
    }, 600);

    return () => clearTimeout(connectTimeout);
  }, [enabled, updates]);

  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [connect, disconnect]);

  useEffect(() => {
    if (enabled && matchId) {
      const cleanup = connect();
      return () => {
        cleanup?.();
        disconnect();
      };
    }

    disconnect();
  }, [connect, disconnect, enabled, matchId]);

  useEffect(() => {
    if (!isConnected || !enabled || updates.length === 0) {
      return;
    }

    const disconnectChance = setInterval(() => {
      if (Math.random() < 0.015) {
        setIsConnected(false);
        setConnectionError("Live feed interrupted. Reconnecting to ArenaX relay...");
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnect();
        }, 1800);
      }
    }, 12000);

    return () => clearInterval(disconnectChance);
  }, [enabled, isConnected, reconnect, updates.length]);

  return {
    isConnected,
    lastUpdate,
    connectionError,
    reconnect,
    disconnect,
  };
}

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
  const [conflictingReport, setConflictingReport] = useState<ScoreReport | null>(null);

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
