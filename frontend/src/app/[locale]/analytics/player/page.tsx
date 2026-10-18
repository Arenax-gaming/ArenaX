"use client";

import dynamic from "next/dynamic";

// recharts is code-split and client-only — same rationale as the platform
// analytics route (#1086): keep the chart library out of the initial payload.
const PlayerAnalyticsDashboard = dynamic(
  () =>
    import("@/components/analytics/PlayerAnalyticsDashboard").then(
      (m) => m.PlayerAnalyticsDashboard,
    ),
  {
    ssr: false,
    loading: () => (
      <main className="min-h-screen bg-gray-950 p-4 text-white sm:p-6" aria-hidden="true">
        <div className="mb-6 h-6 w-48 animate-pulse rounded bg-gray-800" />
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-800" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-56 animate-pulse rounded-lg bg-gray-800" />
          <div className="h-56 animate-pulse rounded-lg bg-gray-800" />
        </div>
      </main>
    ),
  },
);

export default function PlayerAnalyticsPage() {
  return <PlayerAnalyticsDashboard />;
}
