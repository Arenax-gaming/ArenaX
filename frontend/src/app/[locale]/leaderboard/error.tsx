"use client";

import { useEffect } from "react";
import { PageError } from "@/components/common/PageError";

export default function LeaderboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[LeaderboardPage]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <PageError
        title="Failed to load leaderboard"
        message="We couldn't fetch the rankings. Check your connection and try again."
        onRetry={reset}
      />
    </div>
  );
}
