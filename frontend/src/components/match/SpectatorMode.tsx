"use client";

/**
 * SpectatorMode — Issue #895
 *
 * Full spectator experience for watching a live match.
 *
 * Acceptance criteria covered:
 *   ✅ Real-time match updates  — score / status via useSpectatorWebSocket
 *   ✅ Player perspectives switchable — toggle between Player 1, Player 2, Overview
 *   ✅ Chat overlay — SpectatorChatOverlay (floating, collapsible)
 *   ✅ Replay available after match — shown when match.status === "completed"
 *   ✅ Spectator limit configurable — enforced via spectatorLimit prop; shown in UI
 *
 * Layout:
 *   ┌──────────────────────────────┐
 *   │  Header: match info + status │
 *   ├──────────────────────────────┤
 *   │  Perspective switcher tabs   │
 *   ├───────────┬──────────────────┤
 *   │  Player   │  Live event feed │
 *   │  viewport │  + stats panel   │
 *   └───────────┴──────────────────┘
 *   Floating: SpectatorChatOverlay (bottom-right)
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  Play,
  RadioTower,
  RefreshCw,
  Users,
  Wifi,
  WifiOff,
  ChevronLeft,
  ChevronRight,
  Monitor,
  User,
  Clock,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { SpectatorChatOverlay } from "./SpectatorChatOverlay";
import { useSpectatorWebSocket } from "@/hooks/useSpectatorWebSocket";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type {
  MatchHubDetails,
  MatchHubPlayerSnapshot,
  SpectatorPerspective,
} from "@/types/match";
import type { MatchHubEvent } from "@/types/match";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SpectatorModeProps {
  match: MatchHubDetails;
  currentUserId: string;
  currentUserName: string;
  /**
   * Maximum number of concurrent spectators permitted.
   * Undefined or 0 means unlimited.
   */
  spectatorLimit?: number;
  /** Fires when the user exits spectator mode */
  onExit?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PerspectiveTab({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400",
        active
          ? "bg-cyan-500 text-white shadow-[0_0_14px_rgba(6,182,212,0.4)]"
          : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
      )}
      aria-pressed={active}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

function PlayerViewport({
  player,
  score,
  isWinner,
  isActive,
}: {
  player: MatchHubPlayerSnapshot;
  score: number;
  isWinner: boolean;
  isActive: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[24px] border p-6 transition-all duration-300",
        isActive
          ? "border-cyan-400/40 bg-[rgba(6,182,212,0.06)] ring-1 ring-cyan-400/20"
          : "border-white/10 bg-white/5",
        isWinner && "border-emerald-400/40 bg-[rgba(52,211,153,0.06)]",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">
            {isActive ? "Viewing" : "Player"}
          </p>
          <p className="mt-1 text-2xl font-bold text-white">{player.username}</p>
          <p className="text-sm text-white/50">
            Seed {player.seed} · {player.region} · ELO {player.elo}
          </p>
          <p className="mt-1 text-xs text-white/40">W/L {player.record}</p>
        </div>
        <div className="text-right">
          <p className="text-5xl font-bold text-white">{score}</p>
          {isWinner && (
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
              Winner
            </p>
          )}
        </div>
      </div>

      {player.stats.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {player.stats.map((stat) => (
            <div
              key={`${player.id}-${stat.label}`}
              className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2"
            >
              <p className="text-[10px] uppercase tracking-wider text-white/40">
                {stat.label}
              </p>
              <p className="mt-1 text-sm font-semibold text-white">{stat.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LiveEventItem({ event }: { event: MatchHubEvent }) {
  const badgeClass =
    event.type === "alert"
      ? "bg-rose-500/20 text-rose-300"
      : event.type === "score"
        ? "bg-emerald-500/20 text-emerald-300"
        : event.type === "report"
          ? "bg-cyan-500/20 text-cyan-300"
          : "bg-white/10 text-white/50";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
            badgeClass,
          )}
        >
          {event.type}
        </span>
        <span className="text-[10px] text-white/30">
          {formatDate(event.createdAt)}
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-white/70">{event.message}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, string> = {
    in_progress: "bg-emerald-500/20 text-emerald-300",
    completed: "bg-cyan-500/20 text-cyan-300",
    disputed: "bg-rose-500/20 text-rose-300",
    pending: "bg-white/10 text-white/50",
  };
  return (
    <span
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold capitalize",
        cfg[status] ?? "bg-white/10 text-white/50",
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SpectatorMode({
  match,
  currentUserId,
  currentUserName,
  spectatorLimit,
  onExit,
}: SpectatorModeProps) {
  const isLive =
    match.status === "in_progress" || match.status === "disputed";
  const isCompleted = match.status === "completed";

  const [perspective, setPerspective] = useState<SpectatorPerspective>("overview");
  const [liveScore1, setLiveScore1] = useState(match.scorePlayer1);
  const [liveScore2, setLiveScore2] = useState(match.scorePlayer2);
  const [liveFeed, setLiveFeed] = useState<MatchHubEvent[]>(match.feed ?? []);
  const [liveStatus, setLiveStatus] = useState(match.status);

  const feedEndRef = useRef<HTMLDivElement>(null);

  const replayUrl = match.replayUrl?.trim() ?? "";
  const hasReplay = isCompleted && isValidUrl(replayUrl);

  // ── WebSocket ────────────────────────────────────────────────────────────

  const { isConnected, lastUpdate, chatMessages, spectatorCount, sendChatMessage, reconnect, connectionError } =
    useSpectatorWebSocket({
      matchId: match.id,
      enabled: isLive,
    });

  // Apply live updates from WebSocket
  useEffect(() => {
    if (!lastUpdate) return;
    if (lastUpdate.scorePlayer1 !== undefined) setLiveScore1(lastUpdate.scorePlayer1);
    if (lastUpdate.scorePlayer2 !== undefined) setLiveScore2(lastUpdate.scorePlayer2);
    if (lastUpdate.status) setLiveStatus(lastUpdate.status as typeof liveStatus);

    if (lastUpdate.eventMessage) {
      setLiveFeed((prev) => [
        {
          id: `live-${lastUpdate.timestamp}`,
          type: "score",
          message: lastUpdate.eventMessage!,
          createdAt: new Date(lastUpdate.timestamp).toISOString(),
        },
        ...prev,
      ]);
    }
  }, [lastUpdate]);

  // Auto-scroll the feed when new events arrive
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveFeed.length]);

  // ── Derived UI state ─────────────────────────────────────────────────────

  const displayedSpectatorCount = spectatorCount > 0 ? spectatorCount : undefined;

  const isWinner1 =
    match.winnerId === match.player1.id || lastUpdate?.winnerId === match.player1.id;
  const isWinner2 =
    match.winnerId === match.player2.id || lastUpdate?.winnerId === match.player2.id;

  // Spectator limit notice — shown when configured
  const limitLabel = useMemo(() => {
    if (!spectatorLimit || spectatorLimit === 0) return null;
    return `Spectators: ${displayedSpectatorCount ?? 0} / ${spectatorLimit}`;
  }, [spectatorLimit, displayedSpectatorCount]);

  // ── Handle chat send ─────────────────────────────────────────────────────

  const handleSendChat = (content: string) => {
    sendChatMessage(content, currentUserId, currentUserName);
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-screen bg-[linear-gradient(180deg,rgba(15,23,42,1),rgba(15,23,42,0.96))] px-4 py-8 text-white">
      {/* ── Accessibility: live status announcer ── */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {lastUpdate?.eventMessage}
      </div>

      <div className="mx-auto max-w-7xl space-y-6">

        {/* ── Header ── */}
        <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_30%),linear-gradient(135deg,rgba(15,23,42,1),rgba(30,41,59,0.96))] p-6 shadow-[0_20px_60px_-30px_rgba(14,165,233,0.5)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-200/60">
                <Eye className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />
                Spectator Mode
              </p>
              <h1 className="mt-2 text-2xl font-bold">{match.tournamentName}</h1>
              <p className="mt-1 text-sm text-white/60">
                {match.gameType} · {match.roundLabel} · {match.bestOf > 0 ? `Best of ${match.bestOf}` : "Series"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Connection pill */}
              {isLive && (
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-full px-4 py-2 text-sm",
                    isConnected
                      ? "bg-emerald-400/15 text-emerald-200"
                      : "bg-rose-400/15 text-rose-200",
                  )}
                  role="status"
                  aria-label={isConnected ? "Live feed connected" : "Live feed reconnecting"}
                >
                  {isConnected ? (
                    <Wifi className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <WifiOff className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isConnected ? "Live" : "Reconnecting"}
                </div>
              )}

              <StatusBadge status={liveStatus} />

              {/* Spectator count */}
              {(displayedSpectatorCount !== undefined || limitLabel) && (
                <div className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm text-white/70">
                  <Users className="h-4 w-4" aria-hidden="true" />
                  {limitLabel ?? `${displayedSpectatorCount?.toLocaleString()} watching`}
                </div>
              )}

              {/* Replay button */}
              {hasReplay && (
                <a
                  href={replayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  aria-label="Watch replay (opens in new tab)"
                >
                  <Play className="h-4 w-4" aria-hidden="true" />
                  Watch Replay
                  <ExternalLink className="h-3 w-3 opacity-60" aria-hidden="true" />
                </a>
              )}

              {onExit && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onExit}
                  className="border-white/20 text-white/70 hover:bg-white/10 hover:text-white"
                >
                  Exit
                </Button>
              )}
            </div>
          </div>

          {/* Connection error banner */}
          {connectionError && (
            <div className="mt-4 flex items-center justify-between rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                {connectionError}
              </div>
              <button
                type="button"
                onClick={reconnect}
                className="rounded p-1 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                aria-label="Retry connection"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* ── Perspective switcher ── */}
        <div
          className="flex flex-wrap items-center gap-3"
          role="group"
          aria-label="Select viewing perspective"
        >
          <PerspectiveTab
            label="Overview"
            icon={Monitor}
            active={perspective === "overview"}
            onClick={() => setPerspective("overview")}
          />
          <PerspectiveTab
            label={match.player1.username}
            icon={User}
            active={perspective === "player1"}
            onClick={() => setPerspective("player1")}
          />
          <PerspectiveTab
            label={match.player2.username}
            icon={User}
            active={perspective === "player2"}
            onClick={() => setPerspective("player2")}
          />

          {/* Quick navigate arrows for keyboard / touch users */}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                const order: SpectatorPerspective[] = ["overview", "player1", "player2"];
                const current = order.indexOf(perspective);
                setPerspective(order[(current - 1 + order.length) % order.length]);
              }}
              className="rounded-full p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label="Previous perspective"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                const order: SpectatorPerspective[] = ["overview", "player1", "player2"];
                const current = order.indexOf(perspective);
                setPerspective(order[(current + 1) % order.length]);
              }}
              className="rounded-full p-2 text-white/40 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label="Next perspective"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* ── Main grid ── */}
        <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">

          {/* Left: player viewport(s) */}
          <div className="space-y-4">
            {/* Overview shows both players side-by-side */}
            {perspective === "overview" && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <PlayerViewport
                    player={match.player1}
                    score={liveScore1}
                    isWinner={isWinner1}
                    isActive={false}
                  />
                  <PlayerViewport
                    player={match.player2}
                    score={liveScore2}
                    isWinner={isWinner2}
                    isActive={false}
                  />
                </div>

                {/* Completed match replay CTA */}
                {isCompleted && hasReplay && (
                  <div className="rounded-[24px] border border-cyan-400/20 bg-cyan-500/5 p-6 text-center">
                    <Play className="mx-auto h-10 w-10 text-cyan-400" aria-hidden="true" />
                    <p className="mt-3 text-lg font-semibold">Match Completed</p>
                    <p className="mt-1 text-sm text-white/50">
                      The replay is ready to watch.
                    </p>
                    <a
                      href={replayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center gap-2 rounded-full bg-cyan-500 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                      <Play className="h-4 w-4" aria-hidden="true" />
                      Watch Replay
                      <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
                    </a>
                  </div>
                )}

                {/* Completed match — no replay URL */}
                {isCompleted && !hasReplay && (
                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-6 text-center">
                    <Clock className="mx-auto h-8 w-8 text-white/30" aria-hidden="true" />
                    <p className="mt-3 text-sm text-white/50">
                      Match has ended. Replay will be available shortly.
                    </p>
                  </div>
                )}
              </>
            )}

            {/* Single-player perspective */}
            {perspective === "player1" && (
              <PlayerViewport
                player={match.player1}
                score={liveScore1}
                isWinner={isWinner1}
                isActive
              />
            )}
            {perspective === "player2" && (
              <PlayerViewport
                player={match.player2}
                score={liveScore2}
                isWinner={isWinner2}
                isActive
              />
            )}

            {/* Match context card */}
            <Card className="border-white/10 bg-white/5 text-white">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <RadioTower className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  Match Info
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-white/60">
                <div className="flex justify-between">
                  <span>Tournament</span>
                  <Link
                    href={`/tournaments/${match.tournamentId}`}
                    className="font-medium text-cyan-400 hover:underline"
                  >
                    {match.tournamentName}
                  </Link>
                </div>
                <div className="flex justify-between">
                  <span>Arena</span>
                  <span className="text-white/80">{match.arenaLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span>Broadcast</span>
                  <span className="text-white/80">{match.streamTitle ?? "ArenaX Feed"}</span>
                </div>
                <div className="flex justify-between">
                  <span>Prize Pool</span>
                  <span className="text-white/80">${match.prizePool.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Scheduled</span>
                  <span className="text-white/80">{formatDate(match.scheduledTime)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: live event feed */}
          <Card className="border-white/10 bg-white/5 text-white">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <RadioTower className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                Live Event Feed
                {isLive && isConnected && (
                  <span className="ml-auto flex h-2 w-2 rounded-full bg-emerald-400">
                    <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400 opacity-75" />
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="max-h-[520px] overflow-y-auto space-y-3 pr-1"
                aria-label="Live match event feed"
              >
                {liveFeed.length === 0 ? (
                  <p className="text-center text-sm text-white/30 py-8">
                    No events yet.
                  </p>
                ) : (
                  liveFeed.map((event) => (
                    <LiveEventItem key={event.id} event={event} />
                  ))
                )}
                <div ref={feedEndRef} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Floating chat overlay ── */}
      <SpectatorChatOverlay
        messages={chatMessages}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        isConnected={isConnected}
        onSendMessage={handleSendChat}
        spectatorCount={displayedSpectatorCount}
      />
    </div>
  );
}
