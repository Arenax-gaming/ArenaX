"use client";

import { useState } from "react";
import { Download, X } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";

export function PwaInstallPrompt() {
  const { isInstallable, isInstalled, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState(false);

  if (!isInstallable || isInstalled || dismissed) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 max-w-sm mx-auto">
      <div className="rounded-xl border border-gray-700 bg-gray-900 p-4 shadow-2xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-indigo-600 p-2">
              <Download className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Install ArenaX</p>
              <p className="text-xs text-gray-400">Add to your home screen for the best experience</p>
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300"
            aria-label="Dismiss install prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={install}
          className="mt-3 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
        >
          Install App
        </button>
      </div>
    </div>
  );
}
