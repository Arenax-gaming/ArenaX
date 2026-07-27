'use client';

import { useState, useEffect } from 'react';

interface MatchmakingQueueProps {
  gameMode: string;
  onCancel: () => void;
  onMatchFound: (sessionId: string) => void;
}

export default function MatchmakingQueue({ gameMode, onCancel, onMatchFound }: MatchmakingQueueProps) {
  const [waitTime, setWaitTime] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState(30);
  const [playerCount, setPlayerCount] = useState(0);
  const [isSearching, setIsSearching] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setWaitTime(prev => prev + 1);
    }, 1000);

    // Simulate finding a match
    const matchTimer = setTimeout(() => {
      setIsSearching(false);
      const mockSessionId = `session_${Date.now()}`;
      onMatchFound(mockSessionId);
    }, estimatedTime * 1000);

    return () => {
      clearInterval(timer);
      clearTimeout(matchTimer);
    };
  }, [estimatedTime, onMatchFound]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const remainingEstimate = Math.max(0, estimatedTime - waitTime);
  const estimateLabel = remainingEstimate > 0 ? `~${remainingEstimate}s` : 'Almost there...';

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
      <div className="bg-card/60 backdrop-blur-lg rounded-2xl p-12 border border-border max-w-md w-full mx-4">
        <div className="text-center">
          <div className="relative mb-8">
            <div className="w-32 h-32 mx-auto rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl">🎮</span>
            </div>
          </div>

          <h2 className="text-3xl font-bold text-foreground mb-4">
            Finding Opponents...
          </h2>

          <p className="text-foreground/80 mb-6">
            Game Mode: <span className="text-primary font-semibold">{gameMode}</span>
          </p>

          <div className="bg-muted/50 rounded-xl p-6 mb-6">
            <div className="text-5xl font-mono font-bold text-foreground mb-2">
              {formatTime(waitTime)}
            </div>
            <p className="text-muted-foreground text-sm">Wait Time</p>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-primary">{playerCount}</div>
              <div className="text-muted-foreground text-xs">Players Found</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-success/80">~{estimatedTime - waitTime}s</div>
              <div className="text-muted-foreground text-xs">Estimated</div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min((waitTime / estimatedTime) * 100, 100)}%` }}
              />
            </div>
            
            <button
              onClick={onCancel}
              className="w-full px-6 py-3 bg-destructive/20 hover:bg-destructive/30 text-destructive rounded-lg transition-colors duration-200 border border-destructive/30"
            >
              Cancel Matchmaking
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
