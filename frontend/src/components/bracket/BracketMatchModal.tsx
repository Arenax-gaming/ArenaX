"use client";

import { BracketMatch, PrizeDistribution } from "@/types/bracket";
import { Button } from "@/components/ui/Button";
import {
  Activity,
  AlertTriangle,
  Clock3,
  Medal,
  ShieldCheck,
  Trophy,
  User,
  X,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

interface BracketMatchModalProps {
  match: BracketMatch;
  isOpen: boolean;
  onClose: () => void;
  prizeDistribution?: PrizeDistribution[];
}

const statusStyles = {
  pending: "bg-slate-500/15 text-slate-200 border-slate-400/30",
  ready: "bg-cyan-500/15 text-cyan-200 border-cyan-400/30",
  in_progress: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30",
  completed: "bg-slate-200 text-slate-800 border-slate-300",
  disputed: "bg-rose-500/15 text-rose-200 border-rose-400/30",
} as const;

export function BracketMatchModal({
  match,
  isOpen,
  onClose,
  prizeDistribution,
}: BracketMatchModalProps) {
  if (!isOpen) {
    return null;
  }

  const players = [match.player1, match.player2];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 text-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-slate-950/95 px-6 py-5 backdrop-blur">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">
              Match Detail
            </p>
            <h2 className="mt-1 text-2xl font-semibold">
              {match.label ?? `Match ${match.matchNumber}`}
            </h2>
            <p className="text-sm text-slate-400">
              {match.roundLabel ?? `Round ${match.round}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 p-2 text-slate-300 transition hover:border-white/30 hover:text-white"
            aria-label="Close match details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-8 p-6">
          <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] ${statusStyles[match.status]}`}
                >
                  {match.status.replace("_", " ")}
                </span>
                {typeof match.bestOf === "number" && (
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300">
                    Best of {match.bestOf}
                  </span>
                )}
                {match.isBye && (
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
                    Bye Advance
                  </span>
                )}
              </div>

              <div className="space-y-4">
                {players.map((player, index) => {
                  const isWinner = match.winnerId === player?.id;
                  const score =
                    index === 0 ? match.scorePlayer1 ?? "-" : match.scorePlayer2 ?? "-";

                  return (
                    <div
                      key={player?.id ?? `slot-${index}`}
                      className={`rounded-2xl border p-4 ${
                        isWinner
                          ? "border-emerald-400/40 bg-emerald-500/10"
                          : "border-white/10 bg-slate-900/80"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5">
                            <User className="h-5 w-5 text-slate-300" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-semibold">
                                {player?.username ?? "Open Slot"}
                              </p>
                              {player?.isCurrentUser && (
                                <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[11px] text-cyan-200">
                                  You
                                </span>
                              )}
                              {isWinner && (
                                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                              )}
                            </div>
                            <p className="text-sm text-slate-400">
                              {player
                                ? `Seed ${player.seed ?? "-"} | ${player.region ?? "Global"} | ELO ${player.elo}`
                                : "Awaiting previous match result"}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-3xl font-semibold">{score}</div>
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                            Series
                          </p>
                        </div>
                      </div>

                      {player?.stats?.length ? (
                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                          {player.stats.map((stat) => (
                            <div
                              key={`${player.id}-${stat.label}`}
                              className="rounded-xl border border-white/8 bg-black/10 px-3 py-2"
                            >
                              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                                {stat.label}
                              </p>
                              <p className="mt-1 text-sm font-medium text-slate-100">
                                {stat.value}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.25em] text-slate-300">
                  <Clock3 className="h-4 w-4 text-cyan-300" />
                  Schedule
                </h3>
                <div className="mt-4 space-y-3 text-sm text-slate-300">
                  <p>{match.scheduledTime ? formatDate(match.scheduledTime) : "TBD"}</p>
                  <p>{match.venue ?? "ArenaX Digital Stage"}</p>
                  {match.streamTitle ? <p>{match.streamTitle}</p> : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.25em] text-slate-300">
                  <Activity className="h-4 w-4 text-fuchsia-300" />
                  Match Notes
                </h3>
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  {match.notes ?? "No additional notes posted for this match yet."}
                </p>
                {match.conflictReason ? (
                  <div className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      Conflict Reason
                    </div>
                    <p className="mt-2 text-rose-100/90">{match.conflictReason}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-[0.25em] text-slate-300">
                Score Reports
              </h3>
              <div className="mt-4 space-y-3">
                {match.reports?.length ? (
                  match.reports.map((report) => (
                    <div
                      key={`${report.reporterId}-${report.submittedAt}`}
                      className="rounded-2xl border border-white/10 bg-slate-900/80 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-100">{report.reporterName}</p>
                          <p className="text-xs text-slate-500">
                            {formatDate(report.submittedAt)}
                          </p>
                        </div>
                        <p className="text-lg font-semibold text-white">
                          {report.player1Score} - {report.player2Score}
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">
                    No score submissions recorded yet.
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.25em] text-slate-300">
                <Medal className="h-4 w-4 text-amber-300" />
                Prize Breakdown
              </h3>
              <div className="mt-4 space-y-3">
                {prizeDistribution?.length ? (
                  prizeDistribution.map((prize) => (
                    <div
                      key={prize.position}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3"
                    >
                      <div>
                        <p className="font-medium text-slate-100">
                          {prize.label ?? `Top ${prize.position}`}
                        </p>
                        <p className="text-xs text-slate-500">
                          Position {prize.position}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-white">
                          {prize.amount !== undefined
                            ? `$${prize.amount.toLocaleString()}`
                            : `${prize.percentage}%`}
                        </p>
                        <p className="text-xs text-slate-500">{prize.percentage}% share</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">
                    Prize tiers will appear once the event payout rules are published.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-white/10 px-6 py-5">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}
