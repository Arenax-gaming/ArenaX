/**
 * Issue #1563 — API helper for the admin dashboard KPI summary.
 *
 * Mirrors the error-handling convention established by `adminAnalytics.ts`
 * (issue #1412): a 401/403 throws `Error('UNAUTHORIZED')` so the UI can
 * render a role-gated message rather than a generic failure, even though
 * the middleware + `ProtectedPage` guard should already keep non-admins out
 * before this ever fires.
 */

import { pinnedFetch } from '@/api/certificatePinning';
import type { AdminKpiSummary, KpiDateRange } from '@/types/dashboard';

export async function fetchAdminKpis(
  range: KpiDateRange,
): Promise<AdminKpiSummary> {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  const res = await pinnedFetch(`/api/analytics/kpis?${params.toString()}`);
  if (res.status === 401 || res.status === 403) {
    throw new Error('UNAUTHORIZED');
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch admin KPIs (${res.status})`);
  }
  return res.json() as Promise<AdminKpiSummary>;
}
