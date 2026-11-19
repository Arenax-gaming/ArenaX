/**
 * Issue #1563 — Admin dashboard KPI summary types.
 */

/** Inclusive date-range filter window, as ISO date strings ('YYYY-MM-DD'). */
export interface KpiDateRange {
  from: string;
  to: string;
}

export interface AdminKpiSummary {
  /** Daily active users. */
  dau: number;
  /** Total tournaments created on the platform (lifetime, or within range — server-defined). */
  totalTournaments: number;
  /** Prize pool distributed within the selected date range, in USD. */
  prizePoolDistributed: number;
  /** Tournaments / matches currently under an open dispute. */
  activeDisputes: number;
}
