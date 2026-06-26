"use client";

import { useEffect } from "react";
import { PageError } from "@/components/common/PageError";

export default function WalletError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[WalletPage]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <PageError
        title="Wallet unavailable"
        message="We couldn't load your wallet data. Check your connection and try again."
        onRetry={reset}
      />
    </div>
  );
}
