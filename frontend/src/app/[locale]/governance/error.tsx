"use client";

import { useEffect } from "react";
import { PageError } from "@/components/common/PageError";

export default function GovernanceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GovernancePage]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <PageError
        title="Failed to load governance"
        message="We couldn't fetch governance proposals. Check your connection and try again."
        onRetry={reset}
      />
    </div>
  );
}
