"use client";

import { RefreshCw } from "lucide-react";

export function OfflineRetryButton() {
  return (
    <button
      onClick={() => window.location.reload()}
      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
    >
      <RefreshCw className="h-4 w-4" />
      Try Again
    </button>
  );
}
