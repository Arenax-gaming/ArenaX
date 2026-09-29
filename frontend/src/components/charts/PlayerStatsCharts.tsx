/**
 * PlayerStatsCharts — data-visualisation section for a player's performance.
 *
 * Charts included:
 *  1. Win/Loss ratio — Pie chart
 *  2. KDA over time  — Line chart (kills, deaths, assists)
 *  3. XP progression — Area chart
 *
 * All colours and grid styles come from `chartTheme` to follow the design
 * system's light/dark mode automatically.
 *
 * Usage:
 *   <PlayerStatsCharts stats={playerStats} />
 */
"use client";

import React, { lazy, memo, Suspense, useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import { CHART_COLORS, AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "./chartTheme";

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface KDAPoint {
  date: string;
  kills: number;
  deaths: number;
  assists: number;
}

export interface XPPoint {
  date: string;
  xp: number;
}

export interface PlayerStatsData {
  wins: number;
  losses: number;
  kdaHistory: KDAPoint[];
  xpHistory: XPPoint[];
}

interface PlayerStatsChartsProps {
  stats: PlayerStatsData;
}

/* ── Data selectors ─────────────────────────────────────────────────────── */

/**
 * Above this many points, entry animations are skipped — animating long
 * histories (12+ months) is the main source of re-render lag on mobile.
 */
const ANIMATION_POINT_LIMIT = 60;

const WIN_LOSS_COLORS = [CHART_COLORS.success, CHART_COLORS.destructive];

export function selectWinLossData(wins: number, losses: number) {
  return [
    { name: "Wins", value: wins },
    { name: "Losses", value: losses },
  ];
}

export function selectAnimationDuration(points: number, duration: number) {
  return points > ANIMATION_POINT_LIMIT ? 0 : duration;
}

/* ── Win/Loss Pie ───────────────────────────────────────────────────────── */

const WinLossPie = memo(function WinLossPie({ wins, losses }: { wins: number; losses: number }) {
  const data = useMemo(() => selectWinLossData(wins, losses), [wins, losses]);
  const colors = WIN_LOSS_COLORS;
  const total = wins + losses;

  return (
    <ChartCard
      title="Win / Loss Ratio"
      description={`${wins} wins and ${losses} losses out of ${total} total matches`}
      height={260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={3}
            dataKey="value"
            animationBegin={0}
            animationDuration={800}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={colors[i]} stroke="none" />
            ))}
          </Pie>
          <Tooltip
            content={<ChartTooltip />}
            {...TOOLTIP_STYLE}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(value) => (
              <span style={{ color: CHART_COLORS.foreground, fontSize: 12 }}>
                {value}
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
});

/* ── KDA Line Chart ─────────────────────────────────────────────────────── */

const KDAChart = memo(function KDAChart({ data }: { data: KDAPoint[] }) {
  const animationDuration = selectAnimationDuration(data.length, 900);
  return (
    <ChartCard
      title="KDA Over Time"
      description="Kills, Deaths and Assists per match over recent games"
      height={300}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            iconSize={8}
            formatter={(v) => (
              <span style={{ color: CHART_COLORS.foreground, fontSize: 12 }}>{v}</span>
            )}
          />
          <Line
            type="monotone"
            dataKey="kills"
            stroke={CHART_COLORS.success}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
            animationDuration={animationDuration}
          />
          <Line
            type="monotone"
            dataKey="deaths"
            stroke={CHART_COLORS.destructive}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
            animationDuration={animationDuration}
          />
          <Line
            type="monotone"
            dataKey="assists"
            stroke={CHART_COLORS.warning}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5 }}
            animationDuration={animationDuration}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
});

/* ── XP Area Chart ──────────────────────────────────────────────────────── */

const XPProgressChart = memo(function XPProgressChart({ data }: { data: XPPoint[] }) {
  const animationDuration = selectAnimationDuration(data.length, 900);
  return (
    <ChartCard
      title="XP Progression"
      description="Experience points earned over time"
      height={280}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="xpGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS.primary} stopOpacity={0.3} />
              <stop offset="95%" stopColor={CHART_COLORS.primary} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="xp"
            stroke={CHART_COLORS.primary}
            strokeWidth={2}
            fill="url(#xpGradient)"
            animationDuration={animationDuration}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
});

/* ── Composed export ────────────────────────────────────────────────────── */

export const PlayerStatsCharts = memo(function PlayerStatsCharts({ stats }: PlayerStatsChartsProps) {
  return (
    <section aria-label="Player Performance Charts">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WinLossPie wins={stats.wins} losses={stats.losses} />
        <XPProgressChart data={stats.xpHistory} />
        <div className="md:col-span-2">
          <KDAChart data={stats.kdaHistory} />
        </div>
      </div>
    </section>
  );
});
