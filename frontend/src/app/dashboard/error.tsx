"use client";

import { useEffect } from "react";
import { PageError } from "@/components/common/PageError";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[DashboardPage]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <PageError
        title="Dashboard unavailable"
        message="We couldn't load your dashboard data. Try refreshing the page."
        onRetry={reset}
      />
    </div>
  );
}
