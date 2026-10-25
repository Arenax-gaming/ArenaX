'use client';

/**
 * Issue #1412 — Admin analytics dashboard.
 *
 * Shows DAU, new registrations, tournament counts, total prize pool, and match
 * volume for a selectable time range (7d / 30d / 90d) with Recharts charts and
 * a CSV export button.  Protected by ProtectedPage (requiredRole="admin").
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Download,
  Loader2,
  AlertCircle,
  Users,
  Trophy,
  DollarSign,
  Swords,
} from 'lucide-react';
import { fetchAdminAnalytics, buildCsvFromMetrics } from '@/api/adminAnalytics';
import { ChartCard } from '@/components/charts/ChartCard';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import {
  CHART_COLORS,
  AXIS_PROPS,
  GRID_PROPS,
} from '@/components/charts/chartTheme';
import type { TimeRange } from '@/types/adminAnalytics';

// ─── Time-range selector ──────────────────────────────────────────────────────

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
];

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold text-card-foreground tabular-nums">
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function AdminAnalyticsDashboard() {
  const [range, setRange] = useState<TimeRange>('30d');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-analytics', range],
    queryFn: () => fetchAdminAnalytics(range),
    // Don't retry on auth failures
    retry: (count, err) => {
      if (err instanceof Error && err.message === 'UNAUTHORIZED') return false;
      return count < 2;
    },
  });

  const isUnauthorized =
    isError && error instanceof Error && error.message === 'UNAUTHORIZED';

  // ── CSV export ──────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!data) return;
    const csv = buildCsvFromMetrics(data, range);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arenax-analytics-${range}-${
      new Date().toISOString().slice(0, 10)
    }.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, range]);

  return (
    <section aria-label="Admin analytics dashboard" className="space-y-6">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Time-range selector */}
        <div
          role="group"
          aria-label="Select time range"
          className="flex rounded-lg border border-border p-0.5"
        >
          {TIME_RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              aria-pressed={range === r.value}
              className={[
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                range === r.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Export button */}
        <button
          onClick={handleDownload}
          disabled={!data}
          aria-label="Export analytics as CSV"
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export CSV
        </button>
      </div>

      {/* ── Auth error ── */}
      {isUnauthorized && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          You do not have permission to view this page. Admin access is required.
        </div>
      )}

      {/* ── Generic error ── */}
      {isError && !isUnauthorized && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Failed to load analytics data. Please try again.
        </div>
      )}

      {/* ── Loading spinner ── */}
      {isLoading && (
        <div className="flex items-center justify-center py-24" aria-label="Loading analytics">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ── Data ── */}
      {data && (
        <>
          {/* KPI cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              icon={Users}
              label="Daily Active Users"
              value={data.dau.toLocaleString()}
            />
            <KpiCard
              icon={Users}
              label="New Registrations"
              value={data.newRegistrations.toLocaleString()}
              sub={`past ${range}`}
            />
            <KpiCard
              icon={Trophy}
              label="Active Tournaments"
              value={data.ongoingTournaments.toLocaleString()}
              sub={`${data.upcomingTournaments} upcoming`}
            />
            <KpiCard
              icon={DollarSign}
              label="Total Prize Pool"
              value={`$${(data.totalPrizePool / 100).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`}
            />
            <KpiCard
              icon={Swords}
              label="Match Volume"
              value={data.matchVolume.toLocaleString()}
              sub={`past ${range}`}
            />
          </div>

          {/* Charts — 2-column grid */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* DAU trend */}
            <ChartCard
              title="Daily Active Users"
              description={`Trend over last ${range}`}
            >
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.dauSeries}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="DAU"
                    stroke={CHART_COLORS.primary}
                    fill={CHART_COLORS.primary}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Revenue */}
            <ChartCard
              title="Revenue"
              description={`Prize-pool revenue over last ${range}`}
            >
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.revenueSeries}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis
                    {...AXIS_PROPS}
                    tickFormatter={(v: number) => `$${(v / 100).toFixed(0)}`}
                  />
                  <Tooltip
                    content={
                      <ChartTooltip
                        formatter={(v) =>
                          `$${((v as number) / 100).toFixed(2)}`
                        }
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    name="Revenue (cents)"
                    stroke={CHART_COLORS.success}
                    fill={CHART_COLORS.success}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* New registrations */}
            <ChartCard
              title="New Registrations"
              description={`User sign-ups over last ${range}`}
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.registrationSeries}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend />
                  <Bar
                    dataKey="value"
                    name="Registrations"
                    fill={CHART_COLORS.warning}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Match volume */}
            <ChartCard
              title="Match Volume"
              description={`Matches played over last ${range}`}
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.matchVolumeSeries}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="value"
                    name="Matches"
                    fill={CHART_COLORS.muted}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}
    </section>
  );
}

export default AdminAnalyticsDashboard;
