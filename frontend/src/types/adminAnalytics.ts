/**
 * Issue #1412 — Admin analytics dashboard types.
 */

export type TimeRange = '7d' | '30d' | '90d';

export interface TimeSeries {
  date: string; // 'YYYY-MM-DD'
  value: number;
}

export interface AdminAnalyticsMetrics {
  // KPI cards
  dau: number;
  newRegistrations: number;
  ongoingTournaments: number;
  upcomingTournaments: number;
  /** Total prize pool in USD cents */
  totalPrizePool: number;
  matchVolume: number;

  // Time-series (one entry per day, sorted ascending)
  dauSeries: TimeSeries[];
  registrationSeries: TimeSeries[];
  /** Revenue in USD cents */
  revenueSeries: TimeSeries[];
  matchVolumeSeries: TimeSeries[];
}
