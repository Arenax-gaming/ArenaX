"use client";

/**
 * useNavigationGuard — block leaving a page while `when` is true (Issue #1320).
 *
 * The App Router has no "route change start" event to cancel, so three exits
 * are covered separately:
 *
 *  1. Tab close / reload / typed URL → `beforeunload` (the browser shows its
 *     own generic prompt; custom text is ignored by modern browsers).
 *  2. In-app links → a capture-phase click listener on `document` that runs
 *     before Next's <Link> handler. Same-origin links to another path are
 *     held and `pendingNavigation` is set so the page can render a
 *     ConfirmDialog.
 *  3. Back / Forward → a sentinel history entry. Popping it re-pushes the
 *     sentinel (the user stays) and asks for confirmation; confirming goes
 *     back past it. Next.js' own history state is copied into the sentinel,
 *     because the App Router hard-reloads on a popstate without it.
 *
 * Programmatic navigation inside the page (e.g. "match found → lobby") is
 * not intercepted; use `guardedPush` for in-page buttons that should ask.
 *
 * Everything is removed when `when` turns false (match ended naturally) or
 * the component unmounts, so no stale warnings leak to other pages.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PendingNavigation =
  | { kind: "href"; href: string }
  | { kind: "back" };

const SENTINEL_KEY = "__arenaxNavGuard";

function isGuardableLink(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;

  const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.dataset.navGuard === "ignore") return null;

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  // Same page (hash links, identical URL) isn't leaving.
  if (url.pathname === window.location.pathname && url.search === window.location.search) {
    return null;
  }
  return url.pathname + url.search + url.hash;
}

export interface UseNavigationGuardResult {
  /** A navigation is waiting for the user's decision. */
  isBlocked: boolean;
  /** Proceed with the held navigation. */
  confirm: () => void;
  /** Stay on the page. */
  cancel: () => void;
  /** Navigate from in-page code, asking first while guarded. */
  guardedPush: (href: string) => void;
}

export function useNavigationGuard(when: boolean): UseNavigationGuardResult {
  const router = useRouter();
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const whenRef = useRef(when);
  // Set while we deliberately leave, so our own listeners stand down.
  const bypassRef = useRef(false);

  useEffect(() => {
    whenRef.current = when;
    if (!when) setPending(null);
  }, [when]);

  // 1. beforeunload
  useEffect(() => {
    if (!when) return;
    const handler = (event: BeforeUnloadEvent) => {
      if (bypassRef.current) return;
      event.preventDefault();
      // Required by Chrome/Edge to show the prompt.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [when]);

  // 2. In-app link clicks
  useEffect(() => {
    if (!when) return;
    const handler = (event: MouseEvent) => {
      if (bypassRef.current) return;
      const href = isGuardableLink(event);
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      setPending({ kind: "href", href });
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [when]);

  // 3. Back / Forward
  useEffect(() => {
    if (!when) return;

    const pushSentinel = () => {
      window.history.pushState(
        { ...(window.history.state ?? {}), [SENTINEL_KEY]: true },
        "",
        window.location.href
      );
    };
    pushSentinel();

    const onPopState = () => {
      if (bypassRef.current || !whenRef.current) return;
      // The user stepped off the sentinel: put it back and ask.
      pushSentinel();
      setPending({ kind: "back" });
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      // Guard ended while still on this page (match over / unmount): drop
      // the sentinel so Back doesn't need an extra press.
      if (!bypassRef.current && window.history.state?.[SENTINEL_KEY]) {
        bypassRef.current = true;
        window.history.back();
        // Re-arm after the pop has been dispatched.
        window.setTimeout(() => {
          bypassRef.current = false;
        }, 0);
      }
    };
  }, [when]);

  const confirm = useCallback(() => {
    const target = pending;
    setPending(null);
    if (!target) return;
    bypassRef.current = true;
    if (target.kind === "href") {
      router.push(target.href);
    } else {
      // Past the sentinel and the entry the user originally popped back from.
      window.history.go(-2);
    }
  }, [pending, router]);

  const cancel = useCallback(() => setPending(null), []);

  const guardedPush = useCallback(
    (href: string) => {
      if (whenRef.current && !bypassRef.current) {
        setPending({ kind: "href", href });
      } else {
        router.push(href);
      }
    },
    [router]
  );

  return { isBlocked: pending !== null, confirm, cancel, guardedPush };
}
