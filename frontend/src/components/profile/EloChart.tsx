"use client";

import React, { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/common/PageSkeleton";
import { cn } from "@/lib/utils";
import { ALL_GAMES, useEloHistory, type EloDateRange } from "@/hooks/useEloHistory";
import { EloPoint } from "@/types/user";

const ELO_BASELINE = 1200;

const DATE_RANGE_OPTIONS: { value: EloDateRange; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "season", label: "This Season" },
  { value: "all", label: "All Time" },
];

interface EloChartProps {
  /** Games this player has ELO history for — populates the game dropdown (#1096). */
  games: string[];
  /** Falls back to the first entry in `games`, or ALL_GAMES if empty. */
  defaultGame?: string;
  /** Used only if the initial fetch hasn't resolved yet — avoids a blank chart on first paint. */
  initialData?: EloPoint[];
}

export function EloChart({ games, defaultGame, initialData }: EloChartProps) {
  const [dateRange, setDateRange] = useState<EloDateRange>("30d");
  const [game, setGame] = useState<string>(defaultGame ?? (games[0] ?? ALL_GAMES));

  const { data, isLoading, isFetching } = useEloHistory(game, games, dateRange);
  const points = data ?? initialData ?? [];

  const yDomain = useMemo((): [number, number] => {
    if (points.length === 0) return [ELO_BASELINE - 200, ELO_BASELINE + 200];
    const values = points.map((p) => p.elo);
    const min = Math.min(...values, ELO_BASELINE);
    const max = Math.max(...values, ELO_BASELINE);
    const pad = Math.max(40, Math.round((max - min) * 0.1));
    return [min - pad, max + pad];
  }, [points]);

  return (
    <Card className="col-span-1 lg:col-span-2">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-lg font-semibold">Elo Progress</CardTitle>

        <div className="flex flex-wrap items-center gap-2">
          {/* Date range picker (#1096) */}
          <div
            role="group"
            aria-label="Date range"
            className="flex overflow-hidden rounded-md border border-border text-xs"
          >
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDateRange(opt.value)}
                aria-pressed={dateRange === opt.value}
                className={cn(
                  "px-2.5 py-1.5 transition-colors",
                  dateRange === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Game filter (#1096) */}
          <select
            aria-label="Filter by game"
            value={game}
            onChange={(e) => setGame(e.target.value)}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
          >
            <option value={ALL_GAMES}>All Games</option>
            {games.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative h-[300px] w-full mt-4">
          {/* Skeleton overlay while a filter change is loading — never a blank chart (#1096) */}
          {isFetching && (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center bg-background/60"
              aria-live="polite"
              aria-busy="true"
            >
              <Skeleton className="h-[260px] w-[95%] rounded-lg" />
            </div>
          )}

          {isLoading && points.length === 0 ? null : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={points}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="hsl(var(--muted-foreground) / 0.2)"
                />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(str) => {
                    const date = new Date(str);
                    return date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    });
                  }}
                />
                <YAxis
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  domain={yDomain}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--radius)",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))", fontWeight: "bold" }}
                  itemStyle={{ color: "hsl(var(--primary))" }}
                  labelFormatter={(label) => {
                    const date = new Date(label);
                    return date.toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    });
                  }}
                  formatter={(value: number) => [value, "Elo"]}
                />
                <ReferenceLine
                  y={ELO_BASELINE}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  label={{
                    value: `Baseline (${ELO_BASELINE})`,
                    position: "insideTopLeft",
                    fill: "hsl(var(--muted-foreground))",
                    fontSize: 11,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="elo"
                  stroke="hsl(var(--primary))"
                  strokeWidth={3}
                  dot={{ fill: "hsl(var(--primary))", r: 4 }}
                  activeDot={{ r: 6, strokeWidth: 0 }}
                  animationDuration={1500}
                  isAnimationActive={!isFetching}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
