/**
 * Centralized routing configuration for ArenaX.
 *
 * Defines:
 *  - Route protection requirements (auth, roles, email verification)
 *  - Route metadata (titles, descriptions)
 *  - Route groups for analytics and monitoring
 */

export type RouteRequirement =
  | "public"          // No auth needed
  | "auth"            // Must be logged in
  | "verified"        // Must be logged in + email verified
  | "admin"           // Must have admin role
  | "moderator";      // Must have admin or moderator role

export interface RouteConfig {
  /** Glob-style path pattern (without locale prefix). */
  pattern: string;
  /** What the visitor must satisfy to access this route. */
  requirement: RouteRequirement;
  /** Where to redirect on failure (defaults determined by requirement). */
  redirectTo?: string;
  /** Human-readable route group for analytics. */
  group: "auth" | "dashboard" | "gaming" | "social" | "admin" | "settings" | "public";
}

/**
 * Ordered list — first match wins.
 * Patterns are matched with a simple startsWith check after stripping the
 * locale segment so they are locale-agnostic.
 */
export const ROUTE_CONFIGS: RouteConfig[] = [
  // ── Public routes ────────────────────────────────────────────────────────
  { pattern: "/",                       requirement: "public", group: "public" },
  { pattern: "/login",                  requirement: "public", group: "auth" },
  { pattern: "/register",              requirement: "public", group: "auth" },
  { pattern: "/forgot-password",       requirement: "public", group: "auth" },
  { pattern: "/auth/",                 requirement: "public", group: "auth" },
  { pattern: "/verify-email",          requirement: "public", group: "auth" },
  { pattern: "/about",                 requirement: "public", group: "public" },
  { pattern: "/contact",              requirement: "public", group: "public" },
  { pattern: "/privacy",              requirement: "public", group: "public" },
  { pattern: "/terms",                requirement: "public", group: "public" },
  { pattern: "/accessibility",        requirement: "public", group: "public" },
  { pattern: "/offline",              requirement: "public", group: "public" },
  { pattern: "/tournaments",          requirement: "public", group: "gaming" },
  { pattern: "/leaderboard",          requirement: "public", group: "gaming" },
  { pattern: "/leaderboards",         requirement: "public", group: "gaming" },
  { pattern: "/community",            requirement: "public", group: "social" },
  { pattern: "/profile/",             requirement: "public", group: "social" },

  // ── Admin routes ─────────────────────────────────────────────────────────
  { pattern: "/admin/access-denied",  requirement: "public", group: "admin" },
  { pattern: "/admin",                requirement: "admin",   group: "admin" },

  // ── Authenticated routes ──────────────────────────────────────────────────
  { pattern: "/dashboard",            requirement: "verified", group: "dashboard" },
  { pattern: "/play",                 requirement: "verified", group: "gaming" },
  { pattern: "/matches",              requirement: "verified", group: "gaming" },
  { pattern: "/wallet",               requirement: "verified", group: "dashboard" },
  { pattern: "/profile/edit",         requirement: "verified", group: "settings" },
  { pattern: "/profile/settings",     requirement: "verified", group: "settings" },
  { pattern: "/settings",             requirement: "verified", group: "settings" },
  { pattern: "/friends",              requirement: "verified", group: "social" },
  { pattern: "/messages",             requirement: "verified", group: "social" },
  { pattern: "/notifications",        requirement: "verified", group: "social" },
  { pattern: "/party",                requirement: "verified", group: "gaming" },
  { pattern: "/governance",           requirement: "verified", group: "public" },
  { pattern: "/achievements",         requirement: "verified", group: "gaming" },
  { pattern: "/reputation",           requirement: "verified", group: "gaming" },
  { pattern: "/analytics",            requirement: "verified", group: "dashboard" },
];

/**
 * Returns the config for a given pathname (without locale prefix).
 * Falls back to "public" if no pattern matches.
 */
export function getRouteConfig(pathname: string): RouteConfig {
  const match = ROUTE_CONFIGS.find((cfg) => {
    const pattern = cfg.pattern;
    if (pattern === "/") return pathname === "/";
    return pathname === pattern || pathname.startsWith(pattern);
  });

  return (
    match ?? {
      pattern: pathname,
      requirement: "public",
      group: "public",
    }
  );
}

/**
 * Strip the locale prefix from a pathname so route matching is locale-agnostic.
 * e.g. "/en/dashboard" → "/dashboard", "/ar/admin/users" → "/admin/users"
 */
export function stripLocalePrefix(
  pathname: string,
  locales: readonly string[]
): string {
  for (const locale of locales) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1);
    }
  }
  return pathname;
}
