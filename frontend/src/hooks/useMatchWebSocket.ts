"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Match } from "@/types/match";

export interface MatchUpdate {
  matchId: string;
  scorePlayer1?: number;
  scorePlayer2?: number;
  status?: Match["status"];
  winnerId?: string;
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

// Simulated WebSocket for match updates
// In a real application, this would connect to an actual WebSocket server
export function useMatchWebSocket({
  matchId,
  enabled = true,
}: UseMatchWebSocketOptions): UseMatchWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<MatchUpdate | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disconnect = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    // Simulate connection delay
    setConnectionError(null);
    
    // Simulate WebSocket connection
    const connectTimeout = setTimeout(() => {
      setIsConnected(true);
      
      // Simulate receiving periodic updates (every 2-5 seconds)
      // In a real app, this would be actual WebSocket messages
      if (enabled) {
        intervalRef.current = setInterval(() => {
          // Simulate random score updates for demo purposes
          // In production, this would receive actual match updates from the server
          const randomUpdate: MatchUpdate = {
            matchId,
            timestamp: Date.now(),
            // Simulate occasional score changes
            scorePlayer1: Math.floor(Math.random() * 16),
            scorePlayer2: Math.floor(Math.random() * 16),
          };
          
          setLastUpdate(randomUpdate);
        }, 3000 + Math.random() * 2000);
      }
    }, 500);

    return () => clearTimeout(connectTimeout);
  }, [matchId, enabled]);

  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [disconnect, connect]);

  useEffect(() => {
    if (enabled && matchId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [matchId, enabled, connect, disconnect]);

  // Simulate occasional disconnections for realism
  useEffect(() => {
    if (!isConnected || !enabled) return;

    // Random disconnection simulation (1% chance every 10 seconds)
    const disconnectChance = setInterval(() => {
      if (Math.random() < 0.01) {
        setIsConnected(false);
        setConnectionError("Connection lost. Reconnecting...");
        
        // Auto-reconnect after 2 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnect();
        }, 2000);
      }
    }, 10000);

    return () => clearInterval(disconnectChance);
  }, [isConnected, enabled, reconnect]);

  return {
    isConnected,
    lastUpdate,
    connectionError,
    reconnect,
    disconnect,
  };
}

// Hook for reporting match scores
interface ScoreReport {
  matchId: string;
  player1Score: number;
  player2Score: number;
  reporterId: string;
}

interface UseMatchScoreReportingReturn {
  reportScore: (report: ScoreReport) => Promise<boolean>;
  pendingReport: ScoreReport | null;
  isReporting: boolean;
  conflictDetected: boolean;
  conflictingReport: ScoreReport | null;
  clearConflict: () => void;
}

// Simulated score reporting with conflict detection
export function useMatchScoreReporting(): UseMatchScoreReportingReturn {
  const [isReporting, setIsReporting] = useState(false);
  const [pendingReport, setPendingReport] = useState<ScoreReport | null>(null);
  const [conflictDetected, setConflictDetected] = useState(false);
  const [conflictingReport, setConflictingReport] = useState<ScoreReport | null>(null);

  const reportScore = useCallback(async (report: ScoreReport): Promise<boolean> => {
    setIsReporting(true);
    setPendingReport(report);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Simulate conflict detection (30% chance of conflict for demo)
    const hasConflict = Math.random() < 0.3;

    if (hasConflict) {
      // Create conflicting report
      const conflict: ScoreReport = {
        ...report,
        player1Score: report.player1Score + (Math.random() > 0.5 ? 1 : -1),
        player2Score: report.player2Score + (Math.random() > 0.5 ? 1 : -1),
      };
      
      setConflictDetected(true);
      setConflictingReport(conflict);
      setIsReporting(false);
      return false;
    }

    // Success
    setPendingReport(null);
    setIsReporting(false);
    return true;
  }, []);

  const clearConflict = useCallback(() => {
    setConflictDetected(false);
    setConflictingReport(null);
    setPendingReport(null);
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
