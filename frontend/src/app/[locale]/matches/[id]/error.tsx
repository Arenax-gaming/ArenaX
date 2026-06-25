"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageError } from "@/components/common/PageError";

export default function MatchHubError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("[MatchHubPage]", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <PageError
        title="Failed to load match"
        message="We couldn't fetch the match data. The match may no longer exist or there was a connection issue."
        onRetry={reset}
        retryLabel="Reload match"
      />
    </div>
  );
}
