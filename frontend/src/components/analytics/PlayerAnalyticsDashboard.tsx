"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { usePlayerAnalytics, collectGames, filterMatchHistory } from "@/hooks/usePlayerAnalytics";
import { samplePlayerAnalytics } from "@/lib/playerAnalyticsSample";
import {
  EMPTY_PLAYER_ANALYTICS,
  MatchHistoryFilter,
  MatchOutcome,
} from "@/types/playerAnalytics";

const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#1f2937",
    border: "none",
    borderRadius: 6,
    fontSize: 12,
  },
  labelStyle: { color: "#f9fafb" },
};

const AXIS_STYLE = { fontSize: 11, fill: "#9ca3af" };

const OUTCOME_STYLES: Record<MatchOutcome, string> = {
  win: "text-green-400",
  loss: "text-red-400",
  draw: "text-yellow-400",
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-800 p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-green-400">{sub}</p>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-gray-500">{message}</p>;
}

interface PlayerAnalyticsDashboardProps {
  /** When omitted the dashboard renders a deterministic sample dataset. */
  playerId?: string;
}

/**
 * Advanced per-player analytics dashboard (Issue #1266).
 *
 * Renders win/loss trend, Elo progression, filterable match history, per-game
 * and per-tournament breakdowns, and a peer comparison — all from
 * `usePlayerAnalytics`. Falls back to a sample dataset when no player is
 * selected so the route is always viewable.
 */
export function PlayerAnalyticsDashboard({ playerId }: PlayerAnalyticsDashboardProps) {
  const [game, setGame] = useState<string>("all");
  const [result, setResult] = useState<MatchOutcome | "all">("all");

  const filter: MatchHistoryFilter = useMemo(() => ({ game, result }), [game, result]);
  const { data, isLoading } = usePlayerAnalytics(playerId, filter);

  const analytics = playerId ? data ?? EMPTY_PLAYER_ANALYTICS : samplePlayerAnalytics;
  const { summary } = analytics;

  const games = useMemo(() => collectGames(analytics.matchHistory), [analytics.matchHistory]);
  const rows = useMemo(
    () => filterMatchHistory(analytics.matchHistory, filter),
    [analytics.matchHistory, filter],
  );

  return (
    <main className="min-h-screen bg-gray-950 p-4 text-white sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Player Analytics</h1>
        <span className="rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300">
          Peer cohort: {analytics.peerCohort}
        </span>
      </div>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Win Rate"
          value={`${summary.winRate.toFixed(1)}%`}
          sub={`${summary.wins}W / ${summary.losses}L`}
        />
        <StatCard label="Current Elo" value={String(summary.currentElo)} sub={`Peak ${summary.peakElo}`} />
        <StatCard label="Matches" value={String(summary.matches)} sub={`${summary.draws} draws`} />
        <StatCard
          label="Win Streak"
          value={String(summary.currentStreak)}
          sub={`Best ${summary.bestStreak}`}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Win/loss trend */}
        <section className="rounded-lg bg-gray-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Win / Loss Trend</h2>
          {analytics.winLossTrend.length === 0 ? (
            <EmptyState message="No match trend data yet." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={analytics.winLossTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={AXIS_STYLE} />
                <YAxis tick={AXIS_STYLE} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 12, color: "#9ca3af" }} />
                <Bar dataKey="wins" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="losses" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        {/* Elo progression */}
        <section className="rounded-lg bg-gray-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Elo Progression</h2>
          {analytics.eloProgression.length === 0 ? (
            <EmptyState message="No Elo history yet." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={analytics.eloProgression} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" tick={AXIS_STYLE} />
                <YAxis domain={["dataMin - 20", "dataMax + 20"]} tick={AXIS_STYLE} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Line
                  type="monotone"
                  dataKey="elo"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </section>
      </div>

      {/* Peer comparison */}
      <section className="mb-6 rounded-lg bg-gray-800 p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-300">
          Peer Comparison — {analytics.peerCohort}
        </h2>
        {analytics.peerComparison.length === 0 ? (
          <EmptyState message="No peer comparison data yet." />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={analytics.peerComparison} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="metric" tick={AXIS_STYLE} />
              <YAxis tick={AXIS_STYLE} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 12, color: "#9ca3af" }} />
              <Bar dataKey="player" name="You" fill="#6366f1" radius={[3, 3, 0, 0]} />
              <Bar
                dataKey="peerAverage"
                name="Cohort avg"
                fill="#a5b4fc"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Per-game breakdown */}
        <section className="rounded-lg bg-gray-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Performance by Game</h2>
          {analytics.gameBreakdown.length === 0 ? (
            <EmptyState message="No per-game data yet." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-xs text-gray-400">
                  <th className="pb-2">Game</th>
                  <th className="pb-2 text-right">Matches</th>
                  <th className="pb-2 text-right">W/L</th>
                  <th className="pb-2 text-right">Win %</th>
                  <th className="pb-2 text-right">Avg ΔElo</th>
                </tr>
              </thead>
              <tbody>
                {analytics.gameBreakdown.map((row) => (
                  <tr key={row.game} className="border-b border-gray-800/60">
                    <td className="py-1.5 text-gray-200">{row.game}</td>
                    <td className="py-1.5 text-right text-gray-300">{row.matches}</td>
                    <td className="py-1.5 text-right text-gray-300">
                      {row.wins}/{row.losses}
                    </td>
                    <td className="py-1.5 text-right text-gray-300">{row.winRate.toFixed(1)}%</td>
                    <td
                      className={`py-1.5 text-right ${
                        row.avgEloDelta >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {row.avgEloDelta >= 0 ? "+" : ""}
                      {row.avgEloDelta.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Per-tournament breakdown */}
        <section className="rounded-lg bg-gray-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Tournament Results</h2>
          {analytics.tournamentBreakdown.length === 0 ? (
            <EmptyState message="No tournament history yet." />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-xs text-gray-400">
                  <th className="pb-2">Tournament</th>
                  <th className="pb-2 text-right">Matches</th>
                  <th className="pb-2 text-right">Wins</th>
                  <th className="pb-2 text-right">Placement</th>
                </tr>
              </thead>
              <tbody>
                {analytics.tournamentBreakdown.map((row) => (
                  <tr key={row.id} className="border-b border-gray-800/60">
                    <td className="py-1.5 text-gray-200">{row.name}</td>
                    <td className="py-1.5 text-right text-gray-300">{row.matches}</td>
                    <td className="py-1.5 text-right text-gray-300">{row.wins}</td>
                    <td className="py-1.5 text-right text-gray-300">#{row.placement}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {/* Match history with filters */}
      <section className="rounded-lg bg-gray-800 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-300">Match History</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-400">
              Game
              <select
                aria-label="Filter match history by game"
                value={game}
                onChange={(event) => setGame(event.target.value)}
                className="ml-2 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
              >
                <option value="all">All</option>
                {games.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-400">
              Result
              <select
                aria-label="Filter match history by result"
                value={result}
                onChange={(event) => setResult(event.target.value as MatchOutcome | "all")}
                className="ml-2 rounded border border-gray-700 bg-gray-900 px-2 py-1 text-xs text-gray-200"
              >
                <option value="all">All</option>
                <option value="win">Wins</option>
                <option value="loss">Losses</option>
                <option value="draw">Draws</option>
              </select>
            </label>
          </div>
        </div>

        {isLoading && rows.length === 0 ? (
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-gray-900" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState message="No matches match the current filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-left text-xs text-gray-400">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Game</th>
                  <th className="pb-2">Mode</th>
                  <th className="pb-2">Opponent</th>
                  <th className="pb-2 text-center">Result</th>
                  <th className="pb-2 text-right">Score</th>
                  <th className="pb-2 text-right">ΔElo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-800/60">
                    <td className="py-1.5 text-gray-300">
                      {new Date(entry.playedAt).toLocaleDateString()}
                    </td>
                    <td className="py-1.5 text-gray-200">{entry.game}</td>
                    <td className="py-1.5 text-gray-300">{entry.mode}</td>
                    <td className="py-1.5 text-gray-200">{entry.opponent}</td>
                    <td className={`py-1.5 text-center font-semibold ${OUTCOME_STYLES[entry.result]}`}>
                      {entry.result.toUpperCase()}
                    </td>
                    <td className="py-1.5 text-right text-gray-300">
                      {entry.score}–{entry.opponentScore}
                    </td>
                    <td
                      className={`py-1.5 text-right ${
                        entry.eloDelta >= 0 ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {entry.eloDelta >= 0 ? "+" : ""}
                      {entry.eloDelta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default PlayerAnalyticsDashboard;
