'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle, Circle, Wifi, WifiOff, Users, Swords, RefreshCw } from 'lucide-react';
import CountdownTimer from '@/components/game/CountdownTimer';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/contexts/NotificationContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LobbyPlayer {
  id: string;
  username: string;
  elo_rating: number;
  avatar_url?: string;
  is_ready: boolean;
}

interface LobbySession {
  session_id: string;
  game_mode: string;
  status: string;
  players: LobbyPlayer[];
  created_at: string;
}

type PageState = 'loading' | 'ready' | 'countdown' | 'error';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWsUrl(sessionId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const token =
    localStorage.getItem('auth_token') ?? sessionStorage.getItem('auth_token');
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${protocol}://${window.location.host}/ws/lobby/${sessionId}${qs}`;
}

const GAME_MODE_LABELS: Record<string, string> = {
  '1v1': '1v1 Duel',
  '2v2': '2v2 Team Battle',
  'battle-royale': 'Battle Royale',
  ranked: 'Ranked Match',
  casual: 'Casual Play',
  custom: 'Custom Game',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LobbyPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { addToast } = useNotifications();

  const sessionId = searchParams.get('session') ?? '';

  const [pageState, setPageState] = useState<PageState>('loading');
  const [session, setSession] = useState<LobbySession | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [readyingUp, setReadyingUp] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef(0);
  const closedRef = useRef(false);

  // ── Fetch initial session data ──────────────────────────────────────────────

  const fetchSession = useCallback(async () => {
    if (!sessionId) {
      setErrorMessage('No session ID provided. Please start matchmaking again.');
      setPageState('error');
      return;
    }

    try {
      const data = await api.getMatchSession(sessionId);
      setSession(data);
      setPageState('ready');

      // Sync own ready state from server
      if (user?.id) {
        const self = data.players.find((p) => p.id === user.id);
        if (self) setIsReady(self.is_ready);
      }
    } catch {
      setErrorMessage(
        'This session is invalid or has already expired. Start a new match to try again.',
      );
      setPageState('error');
    }
  }, [sessionId, user?.id]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // ── WebSocket connection ────────────────────────────────────────────────────

  const connectWs = useCallback(() => {
    if (!sessionId || closedRef.current) return;

    try {
      const ws = new WebSocket(buildWsUrl(sessionId));
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        retryRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            players?: LobbyPlayer[];
            player_id?: string;
            is_ready?: boolean;
          };

          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }

          if (msg.type === 'lobby_update' && msg.players) {
            setSession((prev) =>
              prev ? { ...prev, players: msg.players! } : prev,
            );
            // Sync own ready flag
            if (user?.id) {
              const self = msg.players.find((p) => p.id === user.id);
              if (self) setIsReady(self.is_ready);
            }
          }

          if (msg.type === 'player_ready' && msg.player_id) {
            setSession((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                players: prev.players.map((p) =>
                  p.id === msg.player_id ? { ...p, is_ready: msg.is_ready ?? true } : p,
                ),
              };
            });
          }

          if (msg.type === 'game_starting') {
            setPageState('countdown');
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (!closedRef.current) {
          const delay = Math.min(10_000, 1_000 * 2 ** retryRef.current);
          retryRef.current += 1;
          reconnectTimerRef.current = setTimeout(connectWs, delay);
        }
      };

      ws.onerror = () => ws.close();
    } catch {
      // WebSocket constructor can throw in some environments
    }
  }, [sessionId, user?.id]);

  useEffect(() => {
    if (pageState !== 'ready') return;

    closedRef.current = false;
    connectWs();

    return () => {
      closedRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
    // connectWs is stable because its deps (sessionId, user.id) don't change
    // while the lobby is mounted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageState]);

  // ── Ready-up ────────────────────────────────────────────────────────────────

  const handleReadyUp = async () => {
    if (readyingUp) return;
    setReadyingUp(true);
    try {
      await api.readyUp(sessionId);
      setIsReady(true);
      // Optimistically update own player card
      if (user?.id) {
        setSession((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            players: prev.players.map((p) =>
              p.id === user.id ? { ...p, is_ready: true } : p,
            ),
          };
        });
      }
    } catch {
      addToast({
        type: 'error',
        title: 'Ready-up failed',
        message: 'Could not mark you as ready. Please try again.',
        duration: 4000,
      });
    } finally {
      setReadyingUp(false);
    }
  };

  // ── Countdown completion ────────────────────────────────────────────────────

  const handleCountdownComplete = () => {
    router.push(`/game/${sessionId}`);
  };

  // ── Renders ─────────────────────────────────────────────────────────────────

  if (pageState === 'countdown') {
    return <CountdownTimer seconds={5} onComplete={handleCountdownComplete} />;
  }

  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto rounded-full border-4 border-purple-500 border-t-transparent animate-spin mb-4" />
          <p className="text-foreground/80">Loading lobby…</p>
        </div>
      </div>
    );
  }

  if (pageState === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-10 border border-white/20 max-w-md w-full mx-4 text-center">
          <Swords className="w-14 h-14 mx-auto text-red-400 mb-4" />
          <h2 className="text-2xl font-bold text-white mb-3">Session Not Found</h2>
          <p className="text-foreground/70 mb-8">{errorMessage}</p>
          <Link
            href="/play"
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Find New Match
          </Link>
        </div>
      </div>
    );
  }

  const allReady = session!.players.length > 0 && session!.players.every((p) => p.is_ready);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-8 max-w-3xl">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-1">Game Lobby</h1>
          <p className="text-foreground/60 text-sm">
            {GAME_MODE_LABELS[session!.game_mode] ?? session!.game_mode}
          </p>
          <div className="flex items-center justify-center gap-2 mt-2">
            {wsConnected ? (
              <Wifi className="w-4 h-4 text-emerald-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-400 animate-pulse" />
            )}
            <span className={`text-xs ${wsConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
              {wsConnected ? 'Live' : 'Reconnecting…'}
            </span>
          </div>
        </div>

        {/* Players */}
        <div className="bg-white/5 backdrop-blur-lg rounded-2xl border border-white/10 p-6 mb-6">
          <div className="flex items-center gap-2 mb-5">
            <Users className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-semibold text-white">
              Players ({session!.players.length})
            </h2>
          </div>

          <div className="space-y-3">
            {session!.players.map((player) => (
              <div
                key={player.id}
                className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3 border border-white/5"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
                    {player.username[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white font-medium text-sm">
                      {player.username}
                      {player.id === user?.id && (
                        <span className="ml-2 text-xs text-purple-400">(you)</span>
                      )}
                    </p>
                    <p className="text-foreground/50 text-xs">ELO {player.elo_rating}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {player.is_ready ? (
                    <>
                      <CheckCircle className="w-5 h-5 text-emerald-400" />
                      <span className="text-emerald-400 text-sm font-medium">Ready</span>
                    </>
                  ) : (
                    <>
                      <Circle className="w-5 h-5 text-foreground/30" />
                      <span className="text-foreground/40 text-sm">Waiting…</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          {!isReady ? (
            <button
              onClick={handleReadyUp}
              disabled={readyingUp}
              className="flex-1 px-6 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-bold text-lg transition-colors"
            >
              {readyingUp ? 'Marking ready…' : '✓ Ready Up'}
            </button>
          ) : (
            <div className="flex-1 px-6 py-4 bg-emerald-600/20 border border-emerald-500/30 text-emerald-400 rounded-xl font-bold text-lg text-center">
              ✓ You are ready
              {allReady ? ' — starting soon!' : ' — waiting for others…'}
            </div>
          )}

          <Link
            href="/play"
            className="px-6 py-4 bg-white/5 hover:bg-white/10 border border-white/10 text-foreground/70 rounded-xl font-semibold text-center transition-colors"
          >
            Leave
          </Link>
        </div>

      </div>
    </div>
  );
}
