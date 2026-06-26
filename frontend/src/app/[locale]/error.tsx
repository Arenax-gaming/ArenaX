"use client";

import { useEffect } from "react";
import { PageError } from "@/components/common/PageError";
import { logError } from "@/lib/errorLogger";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError(error, { digest: error.digest });
  }, [error]);

  return (
    <PageError
      title="Something went wrong"
      message={error.message}
      onRetry={reset}
      retryLabel="Try again"
    />
  );
}
