"use client";

import { useEffect } from "react";
import { PageError } from "@/components/common/PageError";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AdminPage]", error);
  }, [error]);

  return (
    <div className="container mx-auto p-6 flex min-h-[60vh] items-center justify-center">
      <PageError
        title="Admin panel error"
        message="Something went wrong loading this admin page. Try again or contact support if the problem persists."
        onRetry={reset}
      />
    </div>
  );
}
