"use client";

import { useReportWebVitals } from "next/web-vitals";

export function PerformanceMonitor() {
  useReportWebVitals((metric: any) => {
    // In a real application, you would send this to an analytics service
    // For now, we'll just log it in development or keep it for the metrics task
    if (process.env.NODE_ENV === "development") {
      console.log(metric);
    }
  });

  return null;
}
