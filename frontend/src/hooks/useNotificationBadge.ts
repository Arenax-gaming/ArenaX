"use client";

/**
 * useNotificationBadge (#1095)
 *
 * Reflects the unread notification count (from the existing
 * `useNotifications` hook — no extra API call) in two places a user with
 * ArenaX open in a background tab can actually see:
 *  - the browser tab title: `(3) ArenaX — Dashboard`
 *  - the installed PWA's app icon badge, via the Badging API
 *
 * Next.js App Router sets `document.title` from each page's metadata on
 * every navigation, which would silently wipe out our `(N) ` prefix — a
 * MutationObserver on the `<title>` node re-applies it whenever that
 * happens, rather than only reacting to route-change events we control.
 */

import { useCallback, useEffect, useRef } from "react";
import { useNotifications } from "@/contexts/NotificationContext";

const BADGE_PREFIX_RE = /^\(\d+\)\s/;

export function stripBadgePrefix(title: string): string {
  return title.replace(BADGE_PREFIX_RE, "");
}

export function withBadgePrefix(title: string, count: number): string {
  const base = stripBadgePrefix(title);
  return count > 0 ? `(${count}) ${base}` : base;
}

interface NavigatorWithBadging extends Navigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Clears the PWA app icon badge — call when the user views their notifications (#1095). */
export function clearAppBadge(): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as NavigatorWithBadging;
  if (typeof nav.clearAppBadge === "function") {
    nav.clearAppBadge().catch(() => {});
  }
}

export function useNotificationBadge(): void {
  const { unreadCount } = useNotifications();
  const applyingRef = useRef(false);

  const applyTitleBadge = useCallback((count: number) => {
    if (typeof document === "undefined") return;
    const next = withBadgePrefix(document.title, count);
    if (next !== document.title) {
      applyingRef.current = true;
      document.title = next;
    }
  }, []);

  // Re-apply on unread count changes, and whenever anything else (Next.js
  // route metadata) changes document.title out from under us.
  useEffect(() => {
    applyTitleBadge(unreadCount);

    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return;
    }
    const titleEl = document.querySelector("title");
    if (!titleEl) return;

    const observer = new MutationObserver(() => {
      if (applyingRef.current) {
        // This mutation is the one we just made ourselves — ignore it.
        applyingRef.current = false;
        return;
      }
      applyTitleBadge(unreadCount);
    });
    observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [unreadCount, applyTitleBadge]);

  // Page Visibility API (#1095): catch up immediately when the tab regains
  // focus, in case anything changed the title while it was hidden.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        applyTitleBadge(unreadCount);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [unreadCount, applyTitleBadge]);

  // PWA app icon badge — falls back gracefully when the Badging API isn't
  // supported (most browsers outside installed PWAs) (#1095).
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const nav = navigator as NavigatorWithBadging;

    if (unreadCount > 0 && typeof nav.setAppBadge === "function") {
      nav.setAppBadge(unreadCount).catch(() => {});
    } else if (unreadCount === 0) {
      clearAppBadge();
    }
  }, [unreadCount]);
}

/** Mount once near the app root — see AppLayout.tsx. */
export function NotificationBadgeEffect() {
  useNotificationBadge();
  return null;
}
