/**
 * TournamentResultsCharts — visualisation for tournament outcomes.
 *
 * Charts included:
 *  1. Placement distribution — Horizontal Bar chart
 *  2. Prize pool breakdown   — Pie chart
 *  3. Player progression over rounds — Line chart
 *
 * Usage:
 *   <TournamentResultsCharts data={tournamentData} />
 */
"use client";

import React from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./ChartCard";
import { ChartTooltip } from "./ChartTooltip";
import { CHART_COLORS, AXIS_PROPS, GRID_PROPS, SERIES_COLORS } from "./chartTheme";

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface PlacementPoint {
  placement: string; // e.g. "1st", "2nd", "Top 4"
  players: number;
}

export interface PrizeShare {
  label: string;
  amount: number;
}

export interface RoundProgression {
  round: string;
  [player: string]: string | number;
}

export interface TournamentResultsData {
  placements: PlacementPoint[];
  prizeBreakdown: PrizeShare[];
  /** Keyed by player name; each entry is a score per round */
  roundProgression: RoundProgression[];
  /** Player names for the progression chart */
  players: string[];
}

/* ── Placement Distribution ─────────────────────────────────────────────── */

function PlacementChart({ data }: { data: PlacementPoint[] }) {
  return (
    <ChartCard
      title="Placement Distribution"
      description="How many players finished in each placement bracket"
      height={280}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 20, left: 40, bottom: 5 }}
        >
          <CartesianGrid {...GRID_PROPS} horizontal={false} vertical />
          <XAxis type="number" {...AXIS_PROPS} />
          <YAxis type="category" dataKey="placement" {...AXIS_PROPS} width={55} />
          <Tooltip content={<ChartTooltip />} />
          <Bar
            dataKey="players"
            fill={CHART_COLORS.primary}
            radius={[0, 4, 4, 0]}
            animationDuration={800}
            name="Players"
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ── Prize Pool Pie ─────────────────────────────────────────────────────── */

function PrizePoolChart({ data }: { data: PrizeShare[] }) {
  const total = data.reduce((s, d) => s + d.amount, 0);

  return (
    <ChartCard
      title="Prize Pool Breakdown"
      description={`Total prize pool: ₦${total.toLocaleString()}`}
      height={280}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius="75%"
            paddingAngle={3}
            animationBegin={0}
            animationDuration={800}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} stroke="none" />
            ))}
          </Pie>
          <Tooltip
            content={
              <ChartTooltip formatter={(v) => `₦${Number(v).toLocaleString()}`} />
            }
          />
          <Legend
            iconSize={8}
            formatter={(v) => (
              <span style={{ color: CHART_COLORS.foreground, fontSize: 12 }}>{v}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ── Round Progression Line ─────────────────────────────────────────────── */

function RoundProgressionChart({
  data,
  players,
}: {
  data: RoundProgression[];
  players: string[];
}) {
  return (
    <ChartCard
      title="Player Score Progression"
      description="Cumulative scores of top players across tournament rounds"
      height={300}
      className="md:col-span-2"
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid {...GRID_PROPS} />
          <XAxis dataKey="round" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            iconSize={8}
            formatter={(v) => (
              <span style={{ color: CHART_COLORS.foreground, fontSize: 12 }}>{v}</span>
            )}
          />
          {players.map((player, i) => (
            <Line
              key={player}
              type="monotone"
              dataKey={player}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              animationDuration={900}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ── Composed export ────────────────────────────────────────────────────── */

export function TournamentResultsCharts({ data }: { data: TournamentResultsData }) {
  return (
    <section aria-label="Tournament Results Charts">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PlacementChart data={data.placements} />
        <PrizePoolChart data={data.prizeBreakdown} />
        <RoundProgressionChart data={data.roundProgression} players={data.players} />
      </div>
    </section>
  );
}
