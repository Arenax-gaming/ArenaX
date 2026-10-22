'use client';

import { useMatchmakingQueue } from '@/hooks/useMatchmakingQueue';

interface MatchmakingQueueProps {
  /** Game title used by the matchmaking API, e.g. "arenax". */
  game?: string;
  gameMode: string;
  onCancel: () => void;
  onMatchFound: (matchIdOrSessionId: string) => void;
}

export default function MatchmakingQueue({
  game = 'arenax',
  gameMode,
  onCancel,
  onMatchFound,
}: MatchmakingQueueProps) {
  const {
    position,
    queueSize,
    estimatedWaitTime,
    waitTime,
    isSearching,
    isConnected,
    isReconnecting,
    connectionError,
    matchId,
    reconnect,
  } = useMatchmakingQueue({
    game,
    gameMode,
    onMatchFound,
  });

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercent =
    estimatedWaitTime && estimatedWaitTime > 0
      ? Math.min((waitTime / estimatedWaitTime) * 100, 100)
      : 0;

  const searching = isSearching && !matchId;

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
      <div className="bg-card/60 backdrop-blur-lg rounded-2xl p-12 border border-border max-w-md w-full mx-4">
        <div className="text-center">
          <div className="relative mb-8" aria-hidden="true">
            <div className="w-32 h-32 mx-auto rounded-full border-4 border-primary border-t-transparent animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-4xl">🎮</span>
            </div>
          </div>

          <h2 className="text-3xl font-bold text-foreground mb-4">
            {matchId ? 'Match Found!' : 'Finding Opponents...'}
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

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-primary">
                {position ?? '—'}
              </div>
              <div className="text-muted-foreground text-xs">Queue Position</div>
            </div>
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-primary">{queueSize}</div>
              <div className="text-muted-foreground text-xs">Players in Queue</div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 mb-6">
            <div className="bg-muted/50 rounded-lg p-4 flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Estimated wait</span>
              <span className="text-foreground font-semibold">
                {estimatedWaitTime != null ? `~${formatTime(estimatedWaitTime)}` : 'Calculating…'}
              </span>
            </div>
            <div className="rounded-lg p-3 border border-border flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Live updates</span>
              <span
                className={`text-xs font-medium ${
                  isConnected ? 'text-success' : isReconnecting ? 'text-warning' : 'text-muted-foreground'
                }`}
              >
                {isConnected ? 'Connected' : isReconnecting ? 'Reconnecting…' : 'Offline'}
              </span>
            </div>
          </div>

          {connectionError && (
            <div
              role="alert"
              className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <p>{connectionError}</p>
              {!isReconnecting && (
                <button
                  type="button"
                  onClick={reconnect}
                  className="mt-2 underline underline-offset-2"
                >
                  Retry connection
                </button>
              )}
            </div>
          )}

          <div className="space-y-3">
            <div
              className="w-full bg-muted rounded-full h-2"
              role="progressbar"
              aria-label="Matchmaking progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progressPercent)}
            >
              <div
                className="bg-primary h-2 rounded-full transition-all duration-1000"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <button
              type="button"
              onClick={onCancel}
              disabled={Boolean(matchId)}
              className="w-full px-6 py-3 bg-destructive/20 hover:bg-destructive/30 text-destructive rounded-lg transition-colors duration-200 border border-destructive/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel Matchmaking
            </button>
          </div>

          <p role="status" aria-live="polite" className="sr-only">
            {matchId
              ? 'Match found'
              : searching
                ? `Searching for opponents in ${gameMode} mode, position ${position ?? 'unknown'}`
                : 'Not searching'}
          </p>
        </div>
      </div>
    </div>
  );
}
