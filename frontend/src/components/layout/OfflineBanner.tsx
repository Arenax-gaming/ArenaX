"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { WifiOff, X } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useNotifications } from "@/contexts/NotificationContext";

/**
 * `OfflineBanner` surfaces the browser's online/offline state in the UI.
 *
 * Previously `useNetworkStatus` tracked connectivity correctly but nothing
 * consumed it, so users had no indication their connection had dropped —
 * requests would silently fail with no explanation. This component:
 *
 * - Renders a dismissable, accessible banner at the top of the page while
 *   the browser is offline.
 * - Fires a "Back online" toast the moment connectivity is restored.
 * - Stays hidden on the PWA offline fallback route (`/offline`,
 *   `/[locale]/offline`), which already communicates the offline state.
 *
 * Rendered once in `AppLayout` so it applies uniformly across the app.
 */
export function OfflineBanner() {
  const { isOnline } = useNetworkStatus();
  const pathname = usePathname();
  const { addToast } = useNotifications();
  const [dismissed, setDismissed] = useState(false);
  const wasOnlineRef = useRef(isOnline);

  useEffect(() => {
    const wasOnline = wasOnlineRef.current;

    if (wasOnline && !isOnline) {
      // Connection just dropped: reset dismissal so the banner reappears.
      setDismissed(false);
    } else if (!wasOnline && isOnline) {
      // Connection just came back: let the user know.
      addToast({
        type: "success",
        title: "Back online",
        message: "Your connection has been restored.",
      });
    }

    wasOnlineRef.current = isOnline;
  }, [isOnline, addToast]);

  // Don't shadow the dedicated PWA offline fallback page — it already
  // communicates the offline state on its own.
  const isOfflineFallbackRoute = Boolean(pathname?.endsWith("/offline"));

  if (isOfflineFallbackRoute || isOnline || dismissed) {
    return null;
  }

  // Rendered in normal document flow, as the very first element in
  // AppLayout, so it sits above the sticky header without overlaying (and
  // therefore hiding) it. `z-[60]` keeps it above the header's own
  // `z-50` stacking context for the moment they're both on screen.
  return (
    <div
      role="status"
      aria-live="polite"
      className="relative z-[60] flex w-full items-center justify-center gap-3 border-b border-amber-500/20 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950 shadow-md dark:bg-amber-600 dark:text-amber-50"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>You are offline. Some features may not be available.</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss offline notice"
        className="ml-2 shrink-0 rounded-full p-1 opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-950 dark:focus-visible:ring-amber-50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
