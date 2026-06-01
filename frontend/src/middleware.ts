import { NextRequest, NextResponse } from "next/server";

/**
 * Admin route protection middleware.
 *
 * Runs on the Next.js Edge Runtime — no Node.js APIs available.
 *
 * Protection layers:
 *  1. No token present          → redirect to /login?redirect=<path>
 *  2. Token present but expired → redirect to /login?redirect=<path>&reason=expired
 *  3. Token valid, role ≠ admin → redirect to /admin/access-denied (403 page)
 *  4. Token valid, role = admin → allow through
 *
 * The JWT payload is decoded (base64url) to read the `roles` claim.
 * Full signature verification uses the Web Crypto API (HMAC-SHA256) when
 * ADMIN_JWT_SECRET is set. If the env var is absent the middleware falls back
 * to payload-only inspection — the backend still enforces the signature on
 * every API call, so this is defence-in-depth, not the sole gate.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode a base64url string to a UTF-8 string (Edge-safe). */
function base64UrlDecode(input: string): string {
  // Pad to a multiple of 4 and replace URL-safe chars
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
  token_type?: string;
  [key: string]: unknown;
}

/** Parse the JWT payload without verifying the signature. */
function parseJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const raw = base64UrlDecode(parts[1]);
    return JSON.parse(raw) as JwtPayload;
  } catch {
    return null;
  }
}

/** Verify HMAC-SHA256 signature using the Web Crypto API. */
async function verifyJwtSignature(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const signingInput = encoder.encode(`${parts[0]}.${parts[1]}`);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Decode the signature from base64url
    const sigPadded = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const sigPad = sigPadded.length % 4;
    const sigPadded2 = sigPad ? sigPadded + "=".repeat(4 - sigPad) : sigPadded;
    const sigBytes = Uint8Array.from(atob(sigPadded2), (c) => c.charCodeAt(0));

    return await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, signingInput);
  } catch {
    return false;
  }
}

/** Extract the Bearer token from the Authorization header or auth_token cookie. */
function extractToken(request: NextRequest): string | null {
  // 1. Authorization: Bearer <token>  (set by API calls / SSR fetch)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // 2. auth_token cookie  (set by the client after login)
  const cookieToken = request.cookies.get("auth_token")?.value;
  if (cookieToken) return cookieToken;

  return null;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Build the redirect-back URL for post-login return
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);

  // ── 1. Extract token ──────────────────────────────────────────────────────
  const token = extractToken(request);

  if (!token) {
    // No token at all → send to login
    return NextResponse.redirect(loginUrl);
  }

  // ── 2. Parse payload ──────────────────────────────────────────────────────
  const payload = parseJwtPayload(token);

  if (!payload) {
    // Malformed token → send to login
    return NextResponse.redirect(loginUrl);
  }

  // ── 3. Check expiry ───────────────────────────────────────────────────────
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && payload.exp < nowSeconds) {
    loginUrl.searchParams.set("reason", "expired");
    return NextResponse.redirect(loginUrl);
  }

  // ── 4. Verify signature (when secret is available) ────────────────────────
  const jwtSecret = process.env.ADMIN_JWT_SECRET;
  if (jwtSecret) {
    const valid = await verifyJwtSignature(token, jwtSecret);
    if (!valid) {
      // Tampered token → send to login
      return NextResponse.redirect(loginUrl);
    }
  }

  // ── 5. Check admin role ───────────────────────────────────────────────────
  const roles: string[] = Array.isArray(payload.roles) ? payload.roles : [];
  const isAdmin = roles.includes("admin");

  if (!isAdmin) {
    // Authenticated but not admin → 403 page
    const deniedUrl = new URL("/admin/access-denied", request.url);
    return NextResponse.redirect(deniedUrl);
  }

  // ── 6. Allow through ─────────────────────────────────────────────────────
  // Forward the decoded user info as a request header so server components
  // can read it without re-parsing the token.
  const response = NextResponse.next();
  response.headers.set("x-user-id", String(payload.sub ?? ""));
  response.headers.set("x-user-roles", roles.join(","));
  return response;
}

// ---------------------------------------------------------------------------
// Route matcher — only run on /admin/* paths
// ---------------------------------------------------------------------------
export const config = {
  matcher: ["/admin/:path*"],
};
