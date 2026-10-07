"use client";

import dynamic from "next/dynamic";

// Code-split (#1086): recharts is the single largest contributor to this
// route's bundle — deferring it keeps the initial JS payload lean and avoids
// blocking LCP on a chart library nothing above the fold needs.
const PlatformAnalyticsDashboard = dynamic(
  () =>
    import("@/components/analytics/PlatformAnalyticsDashboard").then(
      (m) => m.PlatformAnalyticsDashboard,
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
        <div className="mb-6 h-52 animate-pulse rounded-lg bg-gray-800" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="h-56 animate-pulse rounded-lg bg-gray-800" />
          <div className="h-56 animate-pulse rounded-lg bg-gray-800" />
        </div>
      </main>
    ),
  },
);

export default function AnalyticsDashboardPage() {
  return <PlatformAnalyticsDashboard />;
}
