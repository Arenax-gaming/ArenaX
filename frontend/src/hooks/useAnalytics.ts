import { useQuery } from "@tanstack/react-query";
import { fetchAdminKpis } from "@/api/adminDashboard";
import type { KpiDateRange } from "@/types/dashboard";

// Re-export so consumers can import from the hooks dir
export { useAnalytics } from "@/components/providers/AnalyticsProvider";

// ─── Admin dashboard KPIs (issue #1563) ─────────────────────────────────────

/** Default KPI window: the last 30 days. */
export function defaultKpiDateRange(): KpiDateRange {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

/**
 * Fetches the admin KPI summary (DAU, total tournaments, prize pool
 * distributed, active disputes) for the given date range and auto-refreshes
 * every 60 seconds per the acceptance criteria in issue #1563.
 */
export function useAdminKpis(range: KpiDateRange) {
  return useQuery({
    queryKey: ["admin-kpis", range.from, range.to],
    queryFn: () => fetchAdminKpis(range),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: (count, err) => {
      if (err instanceof Error && err.message === "UNAUTHORIZED") return false;
      return count < 2;
    },
  });
}
