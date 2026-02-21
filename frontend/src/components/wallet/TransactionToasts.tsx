"use client";

import { X } from "lucide-react";
import { useTxStatus } from "@/hooks/useTxStatus";

const toastStyles: Record<string, string> = {
  pending:
    "border-amber-300 bg-amber-100/90 text-amber-950 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100",
  success:
    "border-emerald-300 bg-emerald-100/90 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-100",
  failed:
    "border-red-300 bg-red-100/90 text-red-950 dark:border-red-700 dark:bg-red-900/50 dark:text-red-100",
};

export function TransactionToasts() {
  const { toasts, dismissToast } = useTxStatus();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-md border p-3 shadow-lg ${toastStyles[toast.status]}`}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              <p className="text-xs font-medium uppercase tracking-wide">
                {toast.status}
              </p>
              <p className="text-xs">
                {toast.asset} {toast.amount.toLocaleString("en-US", { maximumFractionDigits: 7 })} • {toast.direction}
              </p>
              {toast.phase && (
                <p className="text-xs capitalize">Phase: {toast.phase}</p>
              )}
              {toast.reason && <p className="text-xs">{toast.reason}</p>}
              {toast.explorerUrl && (
                <a
                  href={toast.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline"
                >
                  Open Explorer
                </a>
              )}
            </div>

            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="rounded p-1 hover:bg-black/10 dark:hover:bg-white/10"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
