"use client";

import { useEffect } from "react";
import { PageError } from "@/components/common/PageError";

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ProfilePage]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <PageError
        title="Failed to load profile"
        message="We couldn't fetch your profile data. Try refreshing the page."
        onRetry={reset}
      />
    </div>
  );
}
