"use client";

/**
 * AdminKpiDashboard — issue #1563.
 *
 * KPI summary cards for the admin dashboard: DAU, total tournaments, prize
 * pool distributed (within the selected date range), and active disputes.
 * Auto-refreshes every 60s (`useAdminKpis`) and exposes a date-range picker
 * that re-fetches all four cards when changed.
 */

import { useState } from "react";
import { AlertCircle, Users, Trophy, DollarSign, ShieldAlert } from "lucide-react";
import { Skeleton } from "@/components/ui/LoadingSkeleton";
import { useAdminKpis, defaultKpiDateRange } from "@/hooks/useAnalytics";
import type { KpiDateRange } from "@/types/dashboard";

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4" data-testid="kpi-card-skeleton">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-3 h-7 w-20" />
        <Skeleton className="mt-2 h-3 w-16" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-card-foreground tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Simple from/to date-range picker — updates all KPI cards when changed. */
function DateRangePicker({
  range,
  onChange,
}: {
  range: KpiDateRange;
  onChange: (range: KpiDateRange) => void;
}) {
  return (
    <div
      role="group"
      aria-label="KPI date range"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
    >
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        From
        <input
          type="date"
          value={range.from}
          max={range.to}
          onChange={(e) => onChange({ ...range, from: e.target.value })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="KPI range start date"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        To
        <input
          type="date"
          value={range.to}
          min={range.from}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => onChange({ ...range, to: e.target.value })}
          className="rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="KPI range end date"
        />
      </label>
    </div>
  );
}

export function AdminKpiDashboard() {
  const [range, setRange] = useState<KpiDateRange>(() => defaultKpiDateRange());
  const { data, isLoading, isError, error, isFetching } = useAdminKpis(range);

  const isUnauthorized =
    isError && error instanceof Error && error.message === "UNAUTHORIZED";

  return (
    <section aria-label="Admin KPI dashboard" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangePicker range={range} onChange={setRange} />
        {isFetching && !isLoading && (
          <span className="text-xs text-muted-foreground" aria-live="polite">
            Refreshing…
          </span>
        )}
      </div>

      {isUnauthorized && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          You do not have permission to view this page. Admin access is required.
        </div>
      )}

      {isError && !isUnauthorized && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Failed to load KPI data. Please try again.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={Users}
          label="Daily Active Users"
          value={data ? data.dau.toLocaleString() : "—"}
          loading={isLoading}
        />
        <KpiCard
          icon={Trophy}
          label="Total Tournaments"
          value={data ? data.totalTournaments.toLocaleString() : "—"}
          loading={isLoading}
        />
        <KpiCard
          icon={DollarSign}
          label="Prize Pool Distributed"
          value={
            data
              ? `$${data.prizePoolDistributed.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              : "—"
          }
          sub={`${range.from} → ${range.to}`}
          loading={isLoading}
        />
        <KpiCard
          icon={ShieldAlert}
          label="Active Disputes"
          value={data ? data.activeDisputes.toLocaleString() : "—"}
          loading={isLoading}
        />
      </div>
    </section>
  );
}

export default AdminKpiDashboard;
