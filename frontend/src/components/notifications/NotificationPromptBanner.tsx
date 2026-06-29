"use client";

/**
 * NotificationPromptBanner
 *
 * Displays a dismissible banner explaining the benefit of push notifications
 * before requesting browser permission. Complies with the requirement to:
 *   - Defer the permission prompt until after a meaningful user action
 *   - Explain the benefit first
 *   - Not re-show the banner for at least 7 days after dismissal
 */

import React, { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "arenax_push_prompt_dismissed_at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isDismissedRecently(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    return Date.now() - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function recordDismissal(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Ignore storage errors
  }
}

interface NotificationPromptBannerProps {
  /** Extra CSS classes for the wrapper */
  className?: string;
}

export function NotificationPromptBanner({ className }: NotificationPromptBannerProps) {
  const { permission, isSupported, subscribe } = usePushNotifications();
  const [visible, setVisible] = useState(false);
  const [isSubscribing, setIsSubscribing] = useState(false);

  // Decide whether to show the banner on mount
  useEffect(() => {
    if (!isSupported) return;
    if (permission !== "default") return; // already granted or denied
    if (isDismissedRecently()) return;
    setVisible(true);
  }, [isSupported, permission]);

  const handleEnable = async () => {
    setIsSubscribing(true);
    try {
      await subscribe();
      setVisible(false); // permission granted — no need to show banner
    } catch {
      // Permission denied or error — dismiss gracefully
      setVisible(false);
      recordDismissal();
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    recordDismissal();
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Enable push notifications"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4",
        className,
      )}
    >
      <div className="shrink-0 rounded-full bg-primary/10 p-2">
        <Bell className="h-5 w-5 text-primary" aria-hidden="true" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">
          Stay in the loop
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Get notified about match results, tournament start times, and friend
          activity — even when you&apos;re not on the site.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            onClick={handleEnable}
            loading={isSubscribing}
            disabled={isSubscribing}
          >
            Enable notifications
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDismiss}
            disabled={isSubscribing}
          >
            Not now
          </Button>
        </div>
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss notification prompt"
        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
