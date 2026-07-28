import { NextRequest, NextResponse } from "next/server";

/**
 * ArenaX Route Protection Middleware (Edge Runtime).
 *
 * Runs on every request matched by the config.matcher below.
 * Enforces authentication and role requirements before the page renders.
 *
 * Protection layers applied in order:
 *  1. Token absent            → redirect to /[locale]/login?redirect=<path>
 *  2. Token malformed         → redirect to /[locale]/login
 *  3. Token expired           → redirect to /[locale]/login?reason=expired
 *  4. Signature invalid       → redirect to /[locale]/login  (when JWT_SECRET set)
 *  5. Admin route, non-admin  → redirect to /[locale]/admin/access-denied
 *  6. All checks pass         → forward with x-user-id / x-user-roles headers
 *
 * The backend verifies signatures on every API call; this middleware is
 * defence-in-depth and UX (avoid a server round-trip before redirecting).
 */

// ---------------------------------------------------------------------------
// JWT helpers (Edge-safe — no Node.js APIs)
// ---------------------------------------------------------------------------

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const padded2 = pad ? padded + "=".repeat(4 - pad) : padded;
  return atob(padded2);
}

interface JwtPayload {
  sub?: string;
  exp?: number;
  iat?: number;
  roles?: string[];
  email_verified?: boolean;
  token_type?: string;
  [key: string]: unknown;
}

function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(base64UrlDecode(parts[1])) as JwtPayload;
  } catch {
    return null;
  }
}

async function verifyJwtSignature(
  token: string,
  secret: string
): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const sigPadded = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const sigPad = sigPadded.length % 4;
    const sig = Uint8Array.from(
      atob(sigPad ? sigPadded + "=".repeat(4 - sigPad) : sigPadded),
      (c) => c.charCodeAt(0)
    );

    return crypto.subtle.verify(
      "HMAC",
      key,
      sig,
      encoder.encode(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    return false;
  }
}

function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return request.cookies.get("auth_token")?.value ?? null;
}

// ---------------------------------------------------------------------------
// Route classification (locale-agnostic)
// ---------------------------------------------------------------------------

/** Supported locale codes — keep in sync with src/i18n/routing.ts */
const SUPPORTED_LOCALES = ["en", "es", "ar", "fr", "yo"] as const;

/**
 * Strip the locale prefix from a pathname so the path table below is
 * locale-agnostic.  "/en/dashboard" → "/dashboard"
 */
function stripLocale(pathname: string): string {
  for (const locale of SUPPORTED_LOCALES) {
    if (pathname === `/${locale}`) return "/";
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

/**
 * Detect the locale from the pathname, falling back to "en".
 */
function detectLocale(pathname: string): string {
  for (const locale of SUPPORTED_LOCALES) {
    if (pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)) {
      return locale;
    }
  }
  return "en";
}

type RouteType = "public" | "auth" | "admin";

/**
 * Classify a locale-stripped path.
 * First match wins (most-specific patterns listed first).
 */
function classifyRoute(path: string): RouteType {
  // ── Always public ────────────────────────────────────────────────────────
  const publicPrefixes = [
    "/",
    "/login",
    "/register",
    "/forgot-password",
    "/auth/",
    "/verify-email",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/accessibility",
    "/offline",
    "/admin/access-denied",
    // Public browsing — detail pages also public for SEO
    "/tournaments",
    "/leaderboard",
    "/leaderboards",
    "/community",
    "/profile/",
  ];

  if (
    path === "/" ||
    publicPrefixes.some(
      (p) => p !== "/" && (path === p.replace(/\/$/, "") || path.startsWith(p))
    )
  ) {
    return "public";
  }

  // ── Admin ─────────────────────────────────────────────────────────────────
  if (path === "/admin" || path.startsWith("/admin/")) {
    return "admin";
  }

  // ── Everything else requires auth ─────────────────────────────────────────
  return "auth";
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const locale = detectLocale(pathname);
  const strippedPath = stripLocale(pathname);
  const routeType = classifyRoute(strippedPath);

  // Public routes pass straight through
  if (routeType === "public") {
    return NextResponse.next();
  }

  // Build locale-aware login redirect URL
  const loginUrl = new URL(`/${locale}/login`, request.url);
  loginUrl.searchParams.set("redirect", pathname);

  // ── 1. Token extraction ───────────────────────────────────────────────────
  const token = extractToken(request);
  if (!token) {
    return NextResponse.redirect(loginUrl);
  }

  // ── 2. Payload parsing ────────────────────────────────────────────────────
  const payload = parseJwtPayload(token);
  if (!payload) {
    return NextResponse.redirect(loginUrl);
  }

  // ── 3. Expiry check ───────────────────────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < now) {
    loginUrl.searchParams.set("reason", "expired");
    return NextResponse.redirect(loginUrl);
  }

  // ── 4. Signature verification (optional, requires env var) ────────────────
  const jwtSecret = process.env.JWT_SECRET ?? process.env.ADMIN_JWT_SECRET;
  if (jwtSecret) {
    const valid = await verifyJwtSignature(token, jwtSecret);
    if (!valid) {
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── 5. Role enforcement for admin routes ──────────────────────────────────
  const roles: string[] = Array.isArray(payload.roles) ? payload.roles : [];

  if (routeType === "admin" && !roles.includes("admin")) {
    const deniedUrl = new URL(`/${locale}/admin/access-denied`, request.url);
    return NextResponse.redirect(deniedUrl);
  }

  // ── 6. Forward with user context headers ─────────────────────────────────
  const response = NextResponse.next();
  response.headers.set("x-user-id", String(payload.sub ?? ""));
  response.headers.set("x-user-roles", roles.join(","));
  response.headers.set("x-locale", locale);
  return response;
}

// ---------------------------------------------------------------------------
// Route matcher — run on all non-static paths
// Note: this file is src/middleware.ts and is distinct from the top-level
// middleware.ts which handles next-intl locale routing. Both are composed
// by Next.js automatically since src/ middleware takes precedence.
// ---------------------------------------------------------------------------
export const config = {
  matcher: [
    /*
     * Match all paths EXCEPT:
     *  - _next/static  (static assets)
     *  - _next/image   (image optimisation)
     *  - favicon.ico, manifest.json, icons/, public assets
     *  - API routes (handled by backend guards)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|icons/|api/).*)",
  ],
};
