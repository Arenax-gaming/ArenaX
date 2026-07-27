"use client";

/**
 * RouteChangeMonitor
 *
 * A zero-UI component that sits inside the root layout and:
 *   1. Tracks every client-side route change as a page view
 *   2. Measures navigation duration via the Performance API
 *   3. Flushes the analytics buffer when the page is hidden
 *
 * It uses the `usePathname` + `useSearchParams` hooks from next/navigation
 * (App Router) to detect route changes since there is no router event API
 * in App Router the way there was in Pages Router.
 */

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import {
  trackPageView,
  flushRouteAnalytics,
  measureRouteLoad,
} from "@/lib/routeAnalytics";
import { getRouteConfig, stripLocalePrefix } from "@/lib/routeConfig";
import { routing } from "@/i18n/routing";

export function RouteChangeMonitor() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const prevPathRef = useRef<string | null>(null);
  const navStartRef = useRef<number>(Date.now());

  // Track page view on route change
  useEffect(() => {
    const currentPath = pathname + (searchParams.toString() ? `?${searchParams.toString()}` : "");
    if (prevPathRef.current === currentPath) return;

    const strippedPath = stripLocalePrefix(pathname, routing.locales);
    const config = getRouteConfig(strippedPath);

    // Measure how long the last navigation took
    const loadDuration =
      prevPathRef.current !== null
        ? Math.round(Date.now() - navStartRef.current)
        : measureRouteLoad() ?? undefined;

    trackPageView({
      path: currentPath,
      locale,
      group: config.group,
      referrer: prevPathRef.current ?? (typeof document !== "undefined" ? document.referrer : ""),
      loadDuration,
    });

    prevPathRef.current = currentPath;
    navStartRef.current = Date.now();
  }, [pathname, searchParams, locale]);

  // Flush analytics buffer when the tab goes to background or closes
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushRouteAnalytics();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushRouteAnalytics);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushRouteAnalytics);
    };
  }, []);

  return null;
}
