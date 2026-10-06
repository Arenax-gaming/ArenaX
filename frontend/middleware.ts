import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./src/i18n/routing";
import { NONCE_HEADER, buildContentSecurityPolicy, cspHeaderName, generateNonce } from "./src/lib/csp";

const intlMiddleware = createMiddleware(routing);

// ---------------------------------------------------------------------------
// JWT helpers (Edge-safe — no Node.js APIs)
// Merged from src/middleware.ts: Next.js only runs a SINGLE middleware file,
// so the previous src/middleware.ts (auth) shadowed this file (intl) and
// broke locale routing ("Unable to find `next-intl` locale because the
// middleware didn't run") + "/" never redirected to "/en", hanging Playwright
// webServer until timeout. Both concerns now live here: intl first, then auth.
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

/**
 * Combined next-intl + route-protection + CSP-nonce middleware.
 *
 * Order:
 *  1. next-intl locale handling (redirects "/" → "/en", sets locale cookie).
 *     Redirect responses are returned immediately (with CSP header).
 *  2. Auth / role guards (previously in src/middleware.ts).
 *  3. CSP nonce forwarding via request headers for Server Components.
 */
export default async function middleware(request: NextRequest) {
  const intlResponse = intlMiddleware(request);

  const nonce = generateNonce();
  const isDev = process.env.NODE_ENV !== "production";
  const csp = buildContentSecurityPolicy(nonce);
  const headerName = cspHeaderName(isDev);

  // A locale redirect (e.g. "/" -> "/en"): nothing renders on this response,
  // so there's no nonce to forward — just carry the CSP header along.
  if (intlResponse.status >= 300 && intlResponse.status < 400) {
    intlResponse.headers.set(headerName, csp);
    return intlResponse;
  }

  // ── Auth / role guards (locale-aware) ────────────────────────────────────
  const { pathname } = request.nextUrl;
  const locale = detectLocale(pathname);
  const strippedPath = stripLocale(pathname);
  const routeType = classifyRoute(strippedPath);

  if (routeType !== "public") {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("redirect", pathname);

    const token = extractToken(request);
    if (!token) {
      const redirect = NextResponse.redirect(loginUrl);
      redirect.headers.set(headerName, csp);
      intlResponse.headers.forEach((value, key) => {
        if (!redirect.headers.has(key)) redirect.headers.set(key, value);
      });
      return redirect;
    }

    const payload = parseJwtPayload(token);
    if (!payload) {
      const redirect = NextResponse.redirect(loginUrl);
      redirect.headers.set(headerName, csp);
      return redirect;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && payload.exp < now) {
      loginUrl.searchParams.set("reason", "expired");
      const redirect = NextResponse.redirect(loginUrl);
      redirect.headers.set(headerName, csp);
      return redirect;
    }

    const jwtSecret = process.env.JWT_SECRET ?? process.env.ADMIN_JWT_SECRET;
    if (jwtSecret) {
      const valid = await verifyJwtSignature(token, jwtSecret);
      if (!valid) {
        const redirect = NextResponse.redirect(loginUrl);
        redirect.headers.set(headerName, csp);
        return redirect;
      }
    }

    const roles: string[] = Array.isArray(payload.roles) ? payload.roles : [];
    if (routeType === "admin" && !roles.includes("admin")) {
      const deniedUrl = new URL(`/${locale}/admin/access-denied`, request.url);
      const redirect = NextResponse.redirect(deniedUrl);
      redirect.headers.set(headerName, csp);
      return redirect;
    }

    // Auth passed — forward user context + nonce + CSP to the render.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(NONCE_HEADER, nonce);
    requestHeaders.set(headerName, csp);
    requestHeaders.set("x-user-id", String(payload.sub ?? ""));
    requestHeaders.set("x-user-roles", roles.join(","));
    requestHeaders.set("x-locale", locale);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    intlResponse.headers.forEach((value, key) => {
      response.headers.set(key, value);
    });
    response.headers.set(headerName, csp);
    response.headers.set("x-user-id", String(payload.sub ?? ""));
    response.headers.set("x-user-roles", roles.join(","));
    response.headers.set("x-locale", locale);
    return response;
  }

  // Public route: pass through with nonce (existing next-intl + CSP behaviour).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(headerName, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  intlResponse.headers.forEach((value, key) => {
    response.headers.set(key, value);
  });
  response.headers.set(headerName, csp);

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
