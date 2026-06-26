"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  FunnelChart,
  Funnel,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

// ── Mock data (replace with real API calls) ───────────────────────────────────

const dailyEvents = [
  { date: "Jun 18", events: 420 },
  { date: "Jun 19", events: 610 },
  { date: "Jun 20", events: 540 },
  { date: "Jun 21", events: 780 },
  { date: "Jun 22", events: 920 },
  { date: "Jun 23", events: 860 },
  { date: "Jun 24", events: 1040 },
];

const funnelSteps = [
  { name: "Page Visit", value: 1000, fill: "#6366f1" },
  { name: "Registration", value: 640, fill: "#818cf8" },
  { name: "Game Start", value: 420, fill: "#a5b4fc" },
  { name: "Tournament Joined", value: 210, fill: "#c7d2fe" },
  { name: "Purchase Completed", value: 88, fill: "#e0e7ff" },
];

const abData = [
  { variant: "Control", conversions: 12.4 },
  { variant: "Variant", conversions: 17.8 },
];

const topEvents = [
  { event: "page_view", count: 4210 },
  { event: "game_start", count: 1840 },
  { event: "matchmaking_queued", count: 1320 },
  { event: "tournament_joined", count: 870 },
  { event: "purchase_completed", count: 310 },
];

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-800 p-4">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-green-400">{sub}</p>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AnalyticsDashboardPage() {
  return (
    <main className="min-h-screen bg-gray-950 p-4 text-white sm:p-6">
      <h1 className="mb-6 text-xl font-bold">Analytics Dashboard</h1>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Events (7d)" value="6,170" sub="+18% vs prev week" />
        <StatCard label="Active Sessions" value="342" />
        <StatCard label="Avg Session (min)" value="8.4" />
        <StatCard label="Conversion Rate" value="8.8%" sub="+5.4% (Variant)" />
      </div>

      {/* Event trend */}
      <section className="mb-6 rounded-lg bg-gray-800 p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-300">Daily Events (7d)</h2>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={dailyEvents} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="eventGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} />
            <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} />
            <Tooltip
              contentStyle={{ background: "#1f2937", border: "none", borderRadius: 6 }}
              labelStyle={{ color: "#f9fafb" }}
            />
            <Area
              type="monotone"
              dataKey="events"
              stroke="#6366f1"
              fill="url(#eventGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </section>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Activation funnel */}
        <section className="rounded-lg bg-gray-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">Activation Funnel</h2>
          <ResponsiveContainer width="100%" height={220}>
            <FunnelChart>
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "none", borderRadius: 6 }}
                labelStyle={{ color: "#f9fafb" }}
              />
              <Funnel dataKey="value" data={funnelSteps} isAnimationActive>
                <LabelList
                  position="right"
                  fill="#d1d5db"
                  stroke="none"
                  dataKey="name"
                  style={{ fontSize: 11 }}
                />
                {funnelSteps.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        </section>

        {/* A/B test comparison */}
        <section className="rounded-lg bg-gray-800 p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-300">A/B Test — Conversion %</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={abData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="variant" tick={{ fontSize: 12, fill: "#9ca3af" }} />
              <YAxis unit="%" tick={{ fontSize: 11, fill: "#9ca3af" }} />
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "none", borderRadius: 6 }}
                formatter={(v: number) => [`${v}%`, "Conversion"]}
              />
              <Bar dataKey="conversions" radius={[4, 4, 0, 0]}>
                <Cell fill="#6366f1" />
                <Cell fill="#22c55e" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      {/* Top events table */}
      <section className="rounded-lg bg-gray-800 p-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-300">Top Events (7d)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-left text-xs text-gray-400">
              <th className="pb-2">Event</th>
              <th className="pb-2 text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            {topEvents.map((row, i) => (
              <tr key={row.event} className={i % 2 === 0 ? "bg-gray-800" : "bg-gray-750"}>
                <td className="py-1.5 font-mono text-indigo-300">{row.event}</td>
                <td className="py-1.5 text-right text-gray-200">
                  {row.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
