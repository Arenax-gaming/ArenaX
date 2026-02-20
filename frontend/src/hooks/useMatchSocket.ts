"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Match, MatchStatus } from "@/types/match";

export interface MatchSocketMessage {
  type: "match_update" | "score_update" | "match_completed" | "match_disputed" | "connection";
  matchId: string;
  data?: Partial<Match>;
  scorePlayer1?: number;
  scorePlayer2?: number;
  winnerId?: string;
}

export interface UseMatchSocketOptions {
  matchId: string;
  userId?: string;
  onMatchUpdate?: (match: Partial<Match>) => void;
  onScoreUpdate?: (scorePlayer1: number, scorePlayer2: number) => void;
  onMatchCompleted?: (winnerId: string) => void;
  onMatchDisputed?: () => void;
  autoConnect?: boolean;
}

export interface UseMatchSocketReturn {
  match: Partial<Match> | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  submitScore: (scorePlayer1: number, scorePlayer2: number) => Promise<boolean>;
}

export function useMatchSocket({
  matchId,
  userId,
  onMatchUpdate,
  onScoreUpdate,
  onMatchCompleted,
  onMatchDisputed,
  autoConnect = true,
}: UseMatchSocketOptions): UseMatchSocketReturn {
  const [match, setMatch] = useState<Partial<Match> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  // Simulated WebSocket connection (mock)
  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setIsLoading(true);
    setError(null);

    // Simulate WebSocket connection with mock data
    // In production, this would be a real WebSocket connection
    setTimeout(() => {
      // Simulate connection success
      setIsConnected(true);
      setIsLoading(false);
      reconnectAttempts.current = 0;

      // Simulate initial match data
      const mockMatch: Partial<Match> = {
        id: matchId,
        status: "in_progress" as MatchStatus,
        player1Id: "player-1",
        player2Id: "player-2",
        scorePlayer1: 0,
        scorePlayer2: 0,
        startedAt: new Date().toISOString(),
      };
      setMatch(mockMatch);
    }, 500);
  }, [matchId]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    setIsConnected(false);
  }, []);

  // Simulate receiving real-time updates
  useEffect(() => {
    if (!isConnected || !matchId) return;

    // Simulate periodic score updates (for demo purposes)
    const intervalId = setInterval(() => {
      // Random score updates to simulate live match
      setMatch((prev) => {
        if (!prev || prev.status !== "in_progress") return prev;
        
        // Simulate score changes occasionally
        if (Math.random() > 0.7) {
          const player1Score = (prev.scorePlayer1 || 0) + (Math.random() > 0.5 ? 1 : 0);
          const player2Score = (prev.scorePlayer2 || 0) + (Math.random() > 0.5 ? 1 : 0);
          
          onScoreUpdate?.(player1Score, player2Score);
          
          return {
            ...prev,
            scorePlayer1: player1Score,
            scorePlayer2: player2Score,
          };
        }
        return prev;
      });
    }, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isConnected, matchId, onScoreUpdate]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  // Submit score (simulated)
  const submitScore = useCallback(
    async (scorePlayer1: number, scorePlayer2: number): Promise<boolean> => {
      if (!userId) {
        setError("You must be logged in to submit a score");
        return false;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Update local state
        setMatch((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            scorePlayer1,
            scorePlayer2,
          };
        });

        // Notify score update
        onScoreUpdate?.(scorePlayer1, scorePlayer2);

        // Simulate opponent also submitting (for demo, we auto-complete if both would match)
        // In real app, this would wait for both players
        if (Math.random() > 0.5) {
          const winnerId = scorePlayer1 > scorePlayer2 ? "player-1" : "player-2";
          setMatch((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: "completed" as MatchStatus,
              winnerId,
              completedAt: new Date().toISOString(),
            };
          });
          onMatchCompleted?.(winnerId);
        }

        setIsLoading(false);
        return true;
      } catch (err) {
        setError("Failed to submit score. Please try again.");
        setIsLoading(false);
        return false;
      }
    },
    [userId, onScoreUpdate, onMatchCompleted]
  );

  return {
    match,
    isConnected,
    isLoading,
    error,
    connect,
    disconnect,
    submitScore,
  };
}
