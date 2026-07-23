/**
 * Theme system for ArenaX
 *
 * Provides:
 * - CSS-in-JS via typed CSS variable helpers (no runtime library required —
 *   we compose Tailwind + CSS custom properties)
 * - Design token access (colours, spacing, typography, motion, elevation)
 * - Accent colour management (applied as data-accent attribute on <html>)
 * - Responsive breakpoint constants and matching utilities
 * - Style analytics tracking
 */

import type { AccentColor, ThemeMode } from "@/types/settings";

// ─── Design token map ─────────────────────────────────────────────────────────

/**
 * Typed map of every CSS custom property defined in globals.css.
 * Use `token("--primary")` instead of hard-coding colour strings.
 */
export type DesignToken =
  // Core palette
  | "--background" | "--foreground"
  | "--card" | "--card-foreground"
  | "--popover" | "--popover-foreground"
  | "--primary" | "--primary-foreground"
  | "--secondary" | "--secondary-foreground"
  | "--muted" | "--muted-foreground"
  | "--accent" | "--accent-foreground"
  | "--destructive" | "--destructive-foreground"
  | "--border" | "--input" | "--ring" | "--radius"
  // Surface
  | "--surface" | "--surface-raised" | "--surface-overlay"
  // Status
  | "--success" | "--success-foreground" | "--success-muted" | "--success-muted-foreground"
  | "--warning" | "--warning-foreground" | "--warning-muted" | "--warning-muted-foreground"
  | "--info"    | "--info-foreground"    | "--info-muted"    | "--info-muted-foreground"
  // Typography
  | "--font-size-xs" | "--font-size-sm" | "--font-size-base" | "--font-size-lg"
  | "--font-size-xl" | "--font-size-2xl" | "--font-size-3xl" | "--font-size-4xl"
  | "--line-height-tight" | "--line-height-normal" | "--line-height-relaxed"
  // Spacing
  | "--space-1" | "--space-2" | "--space-3" | "--space-4" | "--space-5"
  | "--space-6" | "--space-8" | "--space-10" | "--space-12" | "--space-16"
  // Shadow / elevation
  | "--shadow-sm" | "--shadow-md" | "--shadow-lg" | "--shadow-xl" | "--shadow-glow"
  // Motion
  | "--duration-fast" | "--duration-normal" | "--duration-slow" | "--duration-slower"
  | "--ease-in" | "--ease-out" | "--ease-in-out" | "--ease-spring"
  // Z-index
  | "--z-below" | "--z-base" | "--z-raised" | "--z-dropdown"
  | "--z-sticky" | "--z-overlay" | "--z-modal" | "--z-toast" | "--z-tooltip";

/**
 * Returns the CSS `var(--token)` string for a given design token.
 * Used when you need to pass a CSS value to a style prop.
 *
 * @example
 * const style = { color: token("--primary") };  // "var(--primary)"
 */
export function token(t: DesignToken): string {
  return `var(${t})`;
}

/**
 * Returns the resolved runtime value of a CSS custom property.
 * Only call this client-side (after mount).
 */
export function getTokenValue(t: DesignToken): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(t).trim();
}

/**
 * Sets a CSS custom property on the root element at runtime.
 * Use sparingly — prefer data-accent / className overrides.
 */
export function setTokenValue(t: DesignToken, value: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(t, value);
}

// ─── Accent colour ────────────────────────────────────────────────────────────

/**
 * Maps AccentColor to the HSL values used in globals.css `[data-accent]` rules.
 */
export const ACCENT_HSL: Record<AccentColor, string> = {
  blue:   "217 91% 60%",
  purple: "270 91% 65%",
  green:  "142 71% 45%",
  orange: "25 95% 53%",
  red:    "0 84% 60%",
  pink:   "330 80% 60%",
};

/**
 * Applies the accent colour by setting `data-accent` on `<html>`.
 * The CSS in globals.css overrides `--primary` and `--ring` for the given accent.
 */
export function applyAccentColor(color: AccentColor): void {
  if (typeof document === "undefined") return;
  if (color === "blue") {
    document.documentElement.removeAttribute("data-accent");
  } else {
    document.documentElement.setAttribute("data-accent", color);
  }
  trackStyleEvent("accent_changed", color);
}

/**
 * Returns the current accent colour from the `data-accent` attribute, or "blue".
 */
export function getAccentColor(): AccentColor {
  if (typeof document === "undefined") return "blue";
  return (document.documentElement.getAttribute("data-accent") as AccentColor | null) ?? "blue";
}

// ─── Compact mode ─────────────────────────────────────────────────────────────

export function applyCompactMode(enabled: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("compact", enabled);
  trackStyleEvent("compact_mode", String(enabled));
}

// ─── Animations ──────────────────────────────────────────────────────────────

export function applyAnimationsEnabled(enabled: boolean): void {
  if (typeof document === "undefined") return;
  // When disabled, we add the same class that reduce-motion uses
  document.documentElement.classList.toggle("reduce-motion", !enabled);
}

// ─── Responsive breakpoints ──────────────────────────────────────────────────

/**
 * Named breakpoints matching tailwind.config.ts.
 * Use these in JS where you need numeric values (e.g. ResizeObserver comparisons).
 */
export const BREAKPOINTS = {
  xs: 375,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1400,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/**
 * Returns the current active breakpoint based on `window.innerWidth`.
 */
export function getBreakpoint(): Breakpoint {
  if (typeof window === "undefined") return "lg";
  const w = window.innerWidth;
  if (w < BREAKPOINTS.xs) return "xs";
  if (w < BREAKPOINTS.sm) return "xs";
  if (w < BREAKPOINTS.md) return "sm";
  if (w < BREAKPOINTS.lg) return "md";
  if (w < BREAKPOINTS.xl) return "lg";
  if (w < BREAKPOINTS["2xl"]) return "xl";
  return "2xl";
}

/**
 * Returns true if the viewport is at least `breakpoint` wide.
 */
export function isAtLeast(breakpoint: Breakpoint): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth >= BREAKPOINTS[breakpoint];
}

/**
 * Returns true if the viewport is below `breakpoint`.
 */
export function isBelow(breakpoint: Breakpoint): boolean {
  return !isAtLeast(breakpoint);
}

// ─── CSS-in-JS helpers ────────────────────────────────────────────────────────

/**
 * A tiny typed CSS-in-JS helper that returns a React `style` object.
 * The benefit over inline styles is TypeScript autocomplete + token access.
 *
 * @example
 * const style = css({
 *   color: token("--primary"),
 *   padding: token("--space-4"),
 * });
 */
export function css(
  styles: React.CSSProperties & { [key: `--${string}`]: string },
): React.CSSProperties {
  return styles as React.CSSProperties;
}

/**
 * Merge multiple css() objects, with later arguments winning on conflict.
 */
export function cssmerge(
  ...styles: (React.CSSProperties | undefined | null | false)[]
): React.CSSProperties {
  return Object.assign({}, ...styles.filter(Boolean));
}

/**
 * Creates a responsive style object that applies different values per breakpoint.
 * Only usable client-side (reads window.innerWidth).
 *
 * @example
 * const padding = responsive({ base: "1rem", md: "2rem", lg: "3rem" });
 */
export function responsive(
  values: Partial<Record<Breakpoint | "base", string>>,
): string {
  if (typeof window === "undefined") return values.base ?? "";
  const bp = getBreakpoint();
  const order: (Breakpoint | "base")[] = ["base", "xs", "sm", "md", "lg", "xl", "2xl"];
  const bpIndex = order.indexOf(bp);
  // Walk backwards from current breakpoint to find closest defined value
  for (let i = bpIndex; i >= 0; i--) {
    const key = order[i];
    if (key && values[key] !== undefined) return values[key]!;
  }
  return values.base ?? "";
}

// ─── Style analytics ─────────────────────────────────────────────────────────

export type StyleEventType =
  | "theme_changed"
  | "accent_changed"
  | "compact_mode"
  | "animations_toggled"
  | "responsive_breakpoint";

export interface StyleAnalyticsEntry {
  type: StyleEventType;
  detail?: string;
  timestamp: number;
}

const _styleEvents: StyleAnalyticsEntry[] = [];
const STYLE_STORAGE_KEY = "arenax_style_analytics";

function loadStyleEvents(): void {
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(STYLE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StyleAnalyticsEntry[];
      _styleEvents.push(...parsed);
    }
  } catch {/* ignore */}
}

function saveStyleEvents(): void {
  if (typeof window === "undefined") return;
  try {
    // Keep most recent 100 events
    const toSave = _styleEvents.slice(0, 100);
    sessionStorage.setItem(STYLE_STORAGE_KEY, JSON.stringify(toSave));
  } catch {/* ignore */}
}

// Load on module init
if (typeof window !== "undefined") {
  loadStyleEvents();
}

export function trackStyleEvent(type: StyleEventType, detail?: string): void {
  const entry: StyleAnalyticsEntry = { type, detail, timestamp: Date.now() };
  _styleEvents.unshift(entry);
  if (_styleEvents.length > 100) _styleEvents.length = 100;
  saveStyleEvents();

  // Forward to gtag if present
  const w = window as Window & { gtag?: (...args: unknown[]) => void };
  if (typeof w.gtag === "function") {
    w.gtag("event", "style_action", {
      style_event_type: type,
      style_detail: detail ?? "",
    });
  }
}

export function getStyleEvents(): StyleAnalyticsEntry[] {
  return [..._styleEvents];
}

export function getStyleSummary(): Record<StyleEventType, number> {
  const summary = {} as Record<StyleEventType, number>;
  for (const ev of _styleEvents) {
    summary[ev.type] = (summary[ev.type] ?? 0) + 1;
  }
  return summary;
}

export function clearStyleEvents(): void {
  _styleEvents.length = 0;
  saveStyleEvents();
}
