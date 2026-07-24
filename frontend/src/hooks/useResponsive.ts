"use client";

import { useState, useEffect, useCallback } from "react";
import { BREAKPOINTS, Breakpoint, getBreakpoint, isAtLeast, isBelow } from "@/lib/theme";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseResponsiveReturn {
  /** Current named breakpoint (xs | sm | md | lg | xl | 2xl). */
  breakpoint: Breakpoint;
  /** Current viewport width in pixels. */
  width: number;
  /** Current viewport height in pixels. */
  height: number;
  /** True when viewport is below `md` (mobile-first). */
  isMobile: boolean;
  /** True when viewport is `md` or above but below `lg`. */
  isTablet: boolean;
  /** True when viewport is `lg` or above. */
  isDesktop: boolean;
  /** Returns true when viewport is at least `bp`. */
  atLeast: (bp: Breakpoint) => boolean;
  /** Returns true when viewport is below `bp`. */
  below: (bp: Breakpoint) => boolean;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useResponsive` provides reactive breakpoint and viewport-size information.
 *
 * Uses a `ResizeObserver` on `document.documentElement` for efficient updates
 * (avoids `window.resize` event flooding).
 *
 * SSR-safe: returns sensible defaults (`lg`, 1024, 768) on the server.
 *
 * @example
 * ```tsx
 * const { isMobile, atLeast } = useResponsive();
 *
 * return isMobile ? <MobileView /> : <DesktopView />;
 * ```
 */
export function useResponsive(): UseResponsiveReturn {
  const [dims, setDims] = useState<{ width: number; height: number }>(() => {
    if (typeof window === "undefined") return { width: 1024, height: 768 };
    return { width: window.innerWidth, height: window.innerHeight };
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const update = () => {
      setDims({ width: window.innerWidth, height: window.innerHeight });
    };

    // ResizeObserver is more efficient than window resize
    const ro = new ResizeObserver(update);
    ro.observe(document.documentElement);

    // Also listen to window resize as fallback
    window.addEventListener("resize", update, { passive: true });

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const breakpoint = getBreakpointFromWidth(dims.width);

  const atLeast = useCallback(
    (bp: Breakpoint) => dims.width >= BREAKPOINTS[bp],
    [dims.width],
  );

  const below = useCallback(
    (bp: Breakpoint) => dims.width < BREAKPOINTS[bp],
    [dims.width],
  );

  return {
    breakpoint,
    width: dims.width,
    height: dims.height,
    isMobile: dims.width < BREAKPOINTS.md,
    isTablet: dims.width >= BREAKPOINTS.md && dims.width < BREAKPOINTS.lg,
    isDesktop: dims.width >= BREAKPOINTS.lg,
    atLeast,
    below,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBreakpointFromWidth(w: number): Breakpoint {
  if (w < BREAKPOINTS.xs) return "xs";
  if (w < BREAKPOINTS.sm) return "xs";
  if (w < BREAKPOINTS.md) return "sm";
  if (w < BREAKPOINTS.lg) return "md";
  if (w < BREAKPOINTS.xl) return "lg";
  if (w < BREAKPOINTS["2xl"]) return "xl";
  return "2xl";
}

// ─── useMediaQuery ────────────────────────────────────────────────────────────

/**
 * Low-level hook for arbitrary CSS media queries.
 *
 * @example
 * ```ts
 * const isDark = useMediaQuery("(prefers-color-scheme: dark)");
 * const isLandscape = useMediaQuery("(orientation: landscape)");
 * ```
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
