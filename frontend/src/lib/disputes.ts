import type { Dispute } from "@/types/admin";

/**
 * Queue priority for the admin dispute panel. Open disputes rank above
 * closed ones; among open disputes, older ones, ones where both players
 * filed conflicting score reports, and ones with more evidence come first.
 */
export function disputePriority(dispute: Dispute, now: number = Date.now()): number {
  if (dispute.status !== "OPEN") return -1;
  const created = dispute.createdAt ? Date.parse(dispute.createdAt) : now;
  const ageHours = Math.max(0, (now - created) / 3_600_000);
  const reports = dispute.match.scoreReports ?? [];
  const conflicting =
    reports.length > 1 && new Set(reports.map((r) => r.reportedScore)).size > 1 ? 24 : 0;
  return ageHours + conflicting + dispute.evidenceUrls.length * 2;
}

export type DisputeSort = "priority" | "newest" | "oldest";

export function sortDisputes(disputes: Dispute[], sort: DisputeSort, now?: number): Dispute[] {
  const time = (d: Dispute) => (d.createdAt ? Date.parse(d.createdAt) : 0);
  return [...disputes].sort((a, b) => {
    if (sort === "newest") return time(b) - time(a);
    if (sort === "oldest") return time(a) - time(b);
    return disputePriority(b, now) - disputePriority(a, now);
  });
}
