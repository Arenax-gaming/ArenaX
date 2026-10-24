/**
 * Issue #1412 — API helpers for the admin analytics dashboard.
 */

import { pinnedFetch } from '@/api/certificatePinning';
import type { AdminAnalyticsMetrics, TimeRange } from '@/types/adminAnalytics';

/**
 * Fetch platform analytics for the given time range.
 * Throws `Error('UNAUTHORIZED')` for 401/403 responses so the UI can render
 * a role-gated error message instead of a generic failure.
 */
export async function fetchAdminAnalytics(
  range: TimeRange
): Promise<AdminAnalyticsMetrics> {
  const res = await pinnedFetch(`/api/v1/admin/analytics?range=${range}`);
  if (res.status === 401 || res.status === 403) {
    throw new Error('UNAUTHORIZED');
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch admin analytics (${res.status})`);
  }
  return res.json() as Promise<AdminAnalyticsMetrics>;
}

/**
 * Serialise analytics metrics to CSV for the download button.
 */
export function buildCsvFromMetrics(
  metrics: AdminAnalyticsMetrics,
  range: TimeRange
): string {
  const usd = (cents: number) => (cents / 100).toFixed(2);

  const header = [
    'Metric,Value',
    `Period,${range}`,
    `DAU,${metrics.dau}`,
    `New Registrations,${metrics.newRegistrations}`,
    `Ongoing Tournaments,${metrics.ongoingTournaments}`,
    `Upcoming Tournaments,${metrics.upcomingTournaments}`,
    `Total Prize Pool (USD),${usd(metrics.totalPrizePool)}`,
    `Match Volume,${metrics.matchVolume}`,
  ];

  const seriesHeader = 'Date,DAU,New Registrations,Revenue (USD),Match Volume';
  const seriesRows = metrics.dauSeries.map((d, i) =>
    [
      d.date,
      d.value,
      metrics.registrationSeries[i]?.value ?? '',
      usd(metrics.revenueSeries[i]?.value ?? 0),
      metrics.matchVolumeSeries[i]?.value ?? '',
    ].join(',')
  );

  return [...header, '', seriesHeader, ...seriesRows].join('\n');
}
