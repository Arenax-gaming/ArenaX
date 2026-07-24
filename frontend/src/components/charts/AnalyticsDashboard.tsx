/**
 * AnalyticsDashboard — platform-wide analytics charts.
 *
 * Charts included:
 *  1. Daily active users — Bar chart
 *  2. Revenue over time  — Area chart
 *  3. Match outcomes distribution — Stacked bar chart
 *
 * Usage:
 *   <AnalyticsDashboard data={analyticsData} />
 */
"use client";

import React from "react";
import {
  BarChart,
  Bar,
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
import { CHART_COLORS, AXIS_PROPS, GRID_PROPS } from "./chartTheme";

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface DAUPoint {
  date: string;
  users: number;
}

export interface RevenuePoint {
  date: string;
  revenue: number;
}

export interface MatchOutcomePoint {
  date: string;
  wins: number;
  losses: number;
  draws: number;
}

export interface AnalyticsData {
  dauHistory: DAUPoint[];
  revenueHistory: RevenuePoint[];
  matchOutcomes: MatchOutcomePoint[];
}

/* ── DAU Bar Chart ──────────────────────────────────────────────────────── */

function DAUChart({ data }: { data: DAUPoint[] }) {
  return (
    <ChartCard
      title="Daily Active Users"
      description="Number of active players per day"
      height={280}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            dataKey="users"
            fill={CHART_COLORS.primary}
            radius={[4, 4, 0, 0]}
            animationDuration={800}
            name="Active Users"
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ── Revenue Area Chart ─────────────────────────────────────────────────── */

function RevenueChart({ data }: { data: RevenuePoint[] }) {
  return (
    <ChartCard
      title="Revenue Over Time"
      description="Platform revenue in NGN over recent months"
      height={280}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <defs>
            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={CHART_COLORS.success} stopOpacity={0.3} />
              <stop offset="95%" stopColor={CHART_COLORS.success} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="date" {...AXIS_PROPS} />
          <YAxis
            {...AXIS_PROPS}
            tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            content={<ChartTooltip formatter={(v) => `₦${Number(v).toLocaleString()}`} />}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke={CHART_COLORS.success}
            strokeWidth={2}
            fill="url(#revenueGrad)"
            animationDuration={900}
            name="Revenue"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ── Match Outcomes Stacked Bar ─────────────────────────────────────────── */

function MatchOutcomesChart({ data }: { data: MatchOutcomePoint[] }) {
  return (
    <ChartCard
      title="Match Outcomes"
      description="Distribution of wins, losses, and draws per period"
      height={300}
      className="md:col-span-2"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
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
          <Bar dataKey="wins" stackId="a" fill={CHART_COLORS.success} name="Wins" animationDuration={800} />
          <Bar dataKey="losses" stackId="a" fill={CHART_COLORS.destructive} name="Losses" animationDuration={800} />
          <Bar
            dataKey="draws"
            stackId="a"
            fill={CHART_COLORS.muted}
            name="Draws"
            radius={[4, 4, 0, 0]}
            animationDuration={800}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ── Composed export ────────────────────────────────────────────────────── */

export function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  return (
    <section aria-label="Platform Analytics Dashboard">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DAUChart data={data.dauHistory} />
        <RevenueChart data={data.revenueHistory} />
        <MatchOutcomesChart data={data.matchOutcomes} />
      </div>
    </section>
  );
}
