import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { NONCE_HEADER, buildContentSecurityPolicy, cspHeaderName, generateNonce } from "./lib/csp";

const intlMiddleware = createMiddleware(routing);

// ---------------------------------------------------------------------------
// JWT helpers (Edge-safe — no Node.js APIs)
//
// This file MUST live at src/middleware.ts (not the project root): with a
// src/ app directory Next.js only loads middleware from src/, so the previous
// root-level middleware (next-intl + CSP) never executed — locale routing
// never ran ("Unable to find `next-intl` locale"), "/" never redirected to
// "/en", and Playwright's webServer probe timed out. Both concerns now live
// here: intl first, then auth.
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
 *  3. CSP nonce + user-context forwarding via request headers for Server
 *     Components.
 *
 * Chaining note: next-intl communicates the resolved locale to the render via
 * a REWRITE carrying an `X-NEXT-INTL-LOCALE` request header
 * (`x-middleware-rewrite` + `x-middleware-request-*` response headers). Simply
 * returning a fresh `NextResponse.next()` drops that rewrite, so
 * `getRequestConfig` logs "Unable to find `next-intl` locale" and calls
 * `notFound()`. We therefore re-issue intl's rewrite (when present) with our
 * headers merged in, and set `X-NEXT-INTL-LOCALE` explicitly.
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

  const authRedirect = async (): Promise<NextResponse | null> => {
    if (routeType === "public") return null;

    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("redirect", pathname);

    const deny = (url: URL): NextResponse => {
      const redirect = NextResponse.redirect(url);
      redirect.headers.set(headerName, csp);
      copyIntlMeaningfulHeaders(intlResponse, redirect, headerName);
      return redirect;
    };

    const token = extractToken(request);
    if (!token) return deny(loginUrl);

    const payload = parseJwtPayload(token);
    if (!payload) return deny(loginUrl);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && payload.exp < now) {
      loginUrl.searchParams.set("reason", "expired");
      return deny(loginUrl);
    }

    const jwtSecret = process.env.JWT_SECRET ?? process.env.ADMIN_JWT_SECRET;
    if (jwtSecret) {
      const valid = await verifyJwtSignature(token, jwtSecret);
      if (!valid) return deny(loginUrl);
    }

    const roles: string[] = Array.isArray(payload.roles) ? payload.roles : [];
    if (routeType === "admin" && !roles.includes("admin")) {
      return deny(new URL(`/${locale}/admin/access-denied`, request.url));
    }

    return null;
  };

  const redirect = await authRedirect();
  if (redirect) return redirect;

  // Auth passed (or public route) — forward locale + nonce + user context.
  const token = routeType === "public" ? null : extractToken(request);
  const payload = token ? parseJwtPayload(token) : null;
  const roles: string[] =
    payload && Array.isArray(payload.roles) ? payload.roles : [];

  // Prefer the locale next-intl itself resolved (forwarded on its rewrite);
  // fall back to the pathname prefix (identical for localePrefix: "always").
  const intlLocale = intlResponse.headers.get(
    "x-middleware-request-x-next-intl-locale"
  );
  const requestLocale =
    intlLocale && (SUPPORTED_LOCALES as readonly string[]).includes(intlLocale)
      ? intlLocale
      : locale;

  const requestHeaders = new Headers(request.headers);
  // Preserve the locale resolved by next-intl so getRequestConfig finds it.
  requestHeaders.set("X-NEXT-INTL-LOCALE", requestLocale);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(headerName, csp);
  requestHeaders.set("x-user-id", String(payload?.sub ?? ""));
  requestHeaders.set("x-user-roles", roles.join(","));
  requestHeaders.set("x-locale", locale);

  // Re-issue intl's rewrite (if any) with our merged headers so the locale
  // header actually reaches the render; otherwise plain pass-through.
  const rewriteTarget = intlResponse.headers.get("x-middleware-rewrite");
  const response = rewriteTarget
    ? NextResponse.rewrite(new URL(rewriteTarget, request.url), {
        request: { headers: requestHeaders },
      })
    : NextResponse.next({ request: { headers: requestHeaders } });

  copyIntlMeaningfulHeaders(intlResponse, response, headerName);
  response.headers.set(headerName, csp);
  response.headers.set("x-user-id", String(payload?.sub ?? ""));
  response.headers.set("x-user-roles", roles.join(","));
  response.headers.set("x-locale", locale);
  return response;
}

/**
 * Copy next-intl's meaningful response headers (locale cookie, alternate
 * links) onto our chained response. The `x-middleware-*` internals are
 * regenerated from the request headers we pass to `next()`/`rewrite()`, so
 * they must NOT be copied (they would describe intl's header set, not ours).
 */
function copyIntlMeaningfulHeaders(
  from: NextResponse,
  to: NextResponse,
  cspHeaderName: string
): void {
  from.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-middleware-")) return;
    if (lower === cspHeaderName.toLowerCase()) return;
    // set-cookie is handled below via getSetCookie() (forEach would join
    // multiple cookies with commas, corrupting them).
    if (lower === "set-cookie") return;
    if (!to.headers.has(key)) to.headers.set(key, value);
  });
  const getSetCookie =
    typeof (from.headers as Headers & { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (
          from.headers as Headers & { getSetCookie: () => string[] }
        ).getSetCookie()
      : [];
  for (const cookie of getSetCookie) {
    if (!to.headers.get("set-cookie")?.includes(cookie.split(";")[0])) {
      to.headers.append("set-cookie", cookie);
    }
  }
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
