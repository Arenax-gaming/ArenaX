"use client";

import { useEffect } from "react";
import { PageError } from "@/components/common/PageError";

export default function TournamentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[TournamentsPage]", error);
  }, [error]);

  return (
    <div className="min-h-screen px-4 py-8 bg-background flex items-center justify-center">
      <PageError
        title="Failed to load tournaments"
        message="We couldn't fetch the tournament list. Check your connection and try again."
        onRetry={reset}
      />
    </div>
  );
}
