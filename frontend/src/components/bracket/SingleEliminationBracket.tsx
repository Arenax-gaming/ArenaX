"use client";

import React, { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  BracketData,
  BracketMatch,
  BracketRound,
  BracketSection,
} from "@/types/bracket";
import { BracketMatchModal } from "./BracketMatchModal";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Clock3,
  Eye,
  Sparkles,
  Trophy,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SingleEliminationBracketProps {
  bracketData: BracketData;
  currentUserId?: string;
}

const ROUND_WIDTH = 280;
const ROUND_GAP = 56;
const MATCH_HEIGHT = 114;
const VERTICAL_GAP = 28;
const COLUMN_HEADER_HEIGHT = 56;

export function SingleEliminationBracket({
  bracketData,
  currentUserId,
}: SingleEliminationBracketProps) {
  const [selectedMatch, setSelectedMatch] = useState<BracketMatch | null>(null);

  const processedBracketData = useMemo(() => {
    const markPlayer = (player: BracketMatch["player1"]) =>
      player ? { ...player, isCurrentUser: player.id === currentUserId } : null;

    return {
      ...bracketData,
      sections: bracketData.sections.map((section) => ({
        ...section,
        rounds: section.rounds.map((round) => ({
          ...round,
          matches: round.matches.map((match) => ({
            ...match,
            player1: markPlayer(match.player1),
            player2: markPlayer(match.player2),
          })),
        })),
      })),
    };
  }, [bracketData, currentUserId]);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.12),_transparent_28%),linear-gradient(135deg,_rgba(15,23,42,0.98),_rgba(30,41,59,0.96))] p-4 text-white shadow-[0_30px_80px_-45px_rgba(14,165,233,0.65)] sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">
                Tournament Bracket
              </p>
              <h3 className="mt-1 text-2xl font-semibold">
                {processedBracketData.format === "double_elimination"
                  ? "Interactive Double Elimination View"
                  : "Interactive Single Elimination View"}
              </h3>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Live-active matches glow, user paths are accented, and every node opens richer match intelligence.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-200">
              <LegendPill icon={<Sparkles className="h-3.5 w-3.5" />} label="Your path" className="border-cyan-400/40 bg-cyan-400/10" />
              <LegendPill icon={<Activity className="h-3.5 w-3.5" />} label="Live match" className="border-emerald-400/40 bg-emerald-400/10" />
              <LegendPill icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Dispute" className="border-rose-400/40 bg-rose-400/10" />
            </div>
          </div>

          <div className="space-y-8 overflow-x-auto pb-3">
            {processedBracketData.sections.map((section) => (
              <BracketSectionBoard
                key={section.id}
                section={section}
                activeMatchIds={processedBracketData.activeMatchIds ?? []}
                onMatchClick={setSelectedMatch}
              />
            ))}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Eye className="h-4 w-4 text-cyan-600" />
              ArenaX View State
            </div>
            <div className="mt-4 grid gap-3">
              <StatCard
                label="Format"
                value={
                  processedBracketData.format === "double_elimination"
                    ? "Double Elim"
                    : "Single Elim"
                }
              />
              <StatCard
                label="Active Matches"
                value={String(processedBracketData.activeMatchIds?.length ?? 0)}
              />
              <StatCard
                label="Total Stages"
                value={String(processedBracketData.totalRounds)}
              />
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Trophy className="h-4 w-4 text-amber-500" />
              Prize Distribution
            </div>
            <div className="mt-4 space-y-3">
              {processedBracketData.prizeDistribution.map((prize) => (
                <div
                  key={prize.position}
                  className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-slate-900">
                      {prize.label ?? `Top ${prize.position}`}
                    </p>
                    <p className="text-xs text-slate-500">
                      Position {prize.position}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-900">
                      {prize.amount !== undefined
                        ? `$${prize.amount.toLocaleString()}`
                        : `${prize.percentage}%`}
                    </p>
                    <p className="text-xs text-slate-500">{prize.percentage}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {selectedMatch ? (
        <BracketMatchModal
          match={selectedMatch}
          isOpen={Boolean(selectedMatch)}
          onClose={() => setSelectedMatch(null)}
          prizeDistribution={processedBracketData.prizeDistribution}
        />
      ) : null}
    </div>
  );
}

function BracketSectionBoard({
  section,
  activeMatchIds,
  onMatchClick,
}: {
  section: BracketSection;
  activeMatchIds: string[];
  onMatchClick: (match: BracketMatch) => void;
}) {
  const maxMatches = Math.max(...section.rounds.map((round) => round.matches.length));
  const boardHeight = maxMatches * MATCH_HEIGHT + (maxMatches - 1) * VERTICAL_GAP;
  const boardWidth =
    section.rounds.length * ROUND_WIDTH + (section.rounds.length - 1) * ROUND_GAP;
  const positions = calculatePositions(section.rounds, boardHeight);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold text-white">{section.title}</h4>
          <p className="text-sm text-slate-400">
            {section.type === "losers"
              ? "Elimination pressure and comeback routes."
              : section.type === "finals"
                ? "Final qualification and payout stage."
                : "Primary progression from opening rounds to the title."}
          </p>
        </div>
      </div>

      <div
        className="relative min-w-max rounded-[28px] border border-white/10 bg-white/5 p-6"
        style={{ width: boardWidth + 48, minHeight: boardHeight + COLUMN_HEADER_HEIGHT + 48 }}
      >
        <svg
          width={boardWidth}
          height={boardHeight}
          className="pointer-events-none absolute left-6 overflow-visible"
          style={{ top: 24 + COLUMN_HEADER_HEIGHT }}
          aria-hidden="true"
        >
          {section.rounds.slice(0, -1).flatMap((round, roundIndex) =>
            round.matches.map((match, matchIndex) => {
              const nextRound = section.rounds[roundIndex + 1];
              const nextMatchId = match.nextMatchId;
              if (!nextMatchId) {
                return null;
              }
              const nextMatchIndex = nextRound.matches.findIndex(
                (candidate) => candidate.id === nextMatchId,
              );
              if (nextMatchIndex === -1) {
                return null;
              }

              const startY = positions[roundIndex][matchIndex] + MATCH_HEIGHT / 2;
              const endY = positions[roundIndex + 1][nextMatchIndex] + MATCH_HEIGHT / 2;
              const startX = roundIndex * (ROUND_WIDTH + ROUND_GAP) + ROUND_WIDTH;
              const endX = (roundIndex + 1) * (ROUND_WIDTH + ROUND_GAP);
              const midX = startX + ROUND_GAP / 2;
              const isLive = activeMatchIds.includes(match.id) || match.status === "in_progress";

              return (
                <path
                  key={`${match.id}-${nextMatchId}`}
                  d={`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`}
                  fill="none"
                  stroke={isLive ? "rgba(52, 211, 153, 0.95)" : "rgba(148, 163, 184, 0.45)"}
                  strokeWidth={isLive ? 3 : 2}
                  strokeLinecap="round"
                />
              );
            }),
          )}
        </svg>

        {section.rounds.map((round, roundIndex) => (
          <div
            key={`${section.id}-${round.roundNumber}`}
            className="absolute top-6"
            style={{
              left: 24 + roundIndex * (ROUND_WIDTH + ROUND_GAP),
              width: ROUND_WIDTH,
            }}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                  {round.shortLabel ?? `R${round.roundNumber}`}
                </p>
                <h5 className="text-sm font-semibold text-white">{round.roundName}</h5>
              </div>
              {roundIndex < section.rounds.length - 1 ? (
                <ChevronRight className="h-4 w-4 text-slate-500" />
              ) : null}
            </div>

            <div className="relative">
              {round.matches.map((match, matchIndex) => (
                <div
                  key={match.id}
                  className="absolute left-0"
                  style={{
                    width: ROUND_WIDTH,
                    top: positions[roundIndex][matchIndex],
                  }}
                >
                  <MatchCard
                    match={match}
                    isActive={activeMatchIds.includes(match.id)}
                    onClick={() => onMatchClick(match)}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MatchCard({
  match,
  isActive,
  onClick,
}: {
  match: BracketMatch;
  isActive: boolean;
  onClick: () => void;
}) {
  const isCurrentUserMatch = Boolean(match.player1?.isCurrentUser || match.player2?.isCurrentUser);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full rounded-[24px] border p-4 text-left transition duration-200",
          "bg-slate-950/80 shadow-[0_16px_40px_-30px_rgba(15,23,42,1)]",
          isCurrentUserMatch && "border-cyan-400/70 bg-cyan-400/10 shadow-[0_20px_50px_-35px_rgba(34,211,238,0.8)]",
          isActive && "border-emerald-400/70 bg-emerald-400/10 shadow-[0_20px_50px_-35px_rgba(52,211,153,0.8)]",
          match.status === "disputed" && "border-rose-400/70 bg-rose-500/10",
          !isCurrentUserMatch && !isActive && match.status !== "disputed" && "border-white/10 hover:border-white/25 hover:bg-white/10",
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
              {match.label ?? `Match ${match.matchNumber}`}
            </p>
            <p className="text-xs text-slate-500">
              {match.roundLabel ?? `Round ${match.round}`}
            </p>
          </div>
          <MatchStatusBadge status={match.status} />
        </div>

        <PlayerRow
          player={match.player1}
          score={match.scorePlayer1}
          winnerId={match.winnerId}
        />
        <PlayerRow
          player={match.player2}
          score={match.scorePlayer2}
          winnerId={match.winnerId}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
          {match.scheduledTime ? (
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              {formatTime(match.scheduledTime)}
            </span>
          ) : null}
          {match.streamTitle ? (
            <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-slate-300">
              Stream
            </span>
          ) : null}
          {match.isBye ? (
            <span className="rounded-full border border-amber-400/30 px-2 py-1 text-[10px] text-amber-200">
              Bye
            </span>
          ) : null}
        </div>
      </button>

      <div className="pointer-events-none absolute left-1/2 top-full z-20 hidden w-72 -translate-x-1/2 pt-3 group-hover:block group-focus-within:block">
        <div className="rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-sm text-slate-200 shadow-2xl backdrop-blur">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-cyan-200/70">
            <Eye className="h-3.5 w-3.5" />
            Quick Glance
          </div>
          <p className="mt-3 font-medium text-white">
            {match.player1?.username ?? "TBD"} vs {match.player2?.username ?? "TBD"}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            {match.notes ?? "Open full details for player stats, reports, and payout context."}
          </p>
          {match.conflictReason ? (
            <p className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {match.conflictReason}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  score,
  winnerId,
}: {
  player: BracketMatch["player1"];
  score?: number;
  winnerId?: string;
}) {
  const isWinner = player?.id && winnerId === player.id;

  return (
    <div
      className={cn(
        "mt-2 flex items-center justify-between rounded-2xl px-3 py-2",
        isWinner ? "bg-emerald-500/15" : "bg-white/5",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5">
          <User className="h-4 w-4 text-slate-400" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">
            {player?.username ?? "Awaiting Result"}
          </p>
          <p className="text-xs text-slate-500">
            {player
              ? `Seed ${player.seed ?? "-"} | ${player.record ?? `ELO ${player.elo}`}`
              : "Bracket slot pending"}
          </p>
        </div>
      </div>
      <div className="ml-3 text-right">
        <div className="text-lg font-semibold text-white">
          {typeof score === "number" ? score : "-"}
        </div>
        {player?.isCurrentUser ? (
          <span className="text-[10px] uppercase tracking-[0.25em] text-cyan-200">
            You
          </span>
        ) : null}
      </div>
    </div>
  );
}

function MatchStatusBadge({ status }: { status: BracketMatch["status"] }) {
  const styles = {
    pending: "bg-slate-500/15 text-slate-200",
    ready: "bg-cyan-500/15 text-cyan-200",
    in_progress: "bg-emerald-500/15 text-emerald-200",
    completed: "bg-white/15 text-white",
    disputed: "bg-rose-500/15 text-rose-200",
  } as const;

  return (
    <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em]", styles[status])}>
      {status.replace("_", " ")}
    </span>
  );
}

function LegendPill({
  icon,
  label,
  className,
}: {
  icon: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1.5", className)}>
      {icon}
      {label}
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function calculatePositions(rounds: BracketRound[], boardHeight: number): number[][] {
  const positions: number[][] = [];

  rounds.forEach((round, roundIndex) => {
    const roundHeight = round.matches.length * MATCH_HEIGHT + (round.matches.length - 1) * VERTICAL_GAP;

    if (roundIndex === 0) {
      positions.push(
        round.matches.map((_, matchIndex) => matchIndex * (MATCH_HEIGHT + VERTICAL_GAP)),
      );
      return;
    }

    const previousRoundPositions = positions[roundIndex - 1];
    positions.push(
      round.matches.map((match, matchIndex) => {
        const linkedPrevious = rounds[roundIndex - 1].matches
          .map((previousMatch, previousIndex) => ({
            previousMatch,
            previousIndex,
          }))
          .filter(({ previousMatch }) => previousMatch.nextMatchId === match.id);

        if (linkedPrevious.length >= 2) {
          const first = previousRoundPositions[linkedPrevious[0].previousIndex] + MATCH_HEIGHT / 2;
          const second = previousRoundPositions[linkedPrevious[1].previousIndex] + MATCH_HEIGHT / 2;
          return (first + second) / 2 - MATCH_HEIGHT / 2;
        }

        if (linkedPrevious.length === 1) {
          return previousRoundPositions[linkedPrevious[0].previousIndex];
        }

        if (round.matches.length === 1) {
          return boardHeight / 2 - MATCH_HEIGHT / 2;
        }

        const spacing =
          round.matches.length > 1
            ? (boardHeight - roundHeight) / (round.matches.length - 1)
            : 0;
        return matchIndex * (MATCH_HEIGHT + spacing);
      }),
    );
  });

  return positions;
}

function formatTime(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}
