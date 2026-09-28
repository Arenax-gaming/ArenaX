import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./src/i18n/routing";
import { NONCE_HEADER, buildContentSecurityPolicy, cspHeaderName, generateNonce } from "./src/lib/csp";

const intlMiddleware = createMiddleware(routing);

/**
 * Wraps next-intl's locale middleware with a per-request CSP nonce (#1091).
 * The nonce is forwarded to the page render via a request header (the only
 * way a Server Component can read it, via `headers()` in `layout.tsx`) and
 * set as the CSP response header.
 */
export default function middleware(request: NextRequest) {
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

  // Pass-through/rewrite: rebuild the response so the nonce reaches the
  // actual render via request headers, while preserving anything next-intl
  // itself set on its response (e.g. the locale cookie).
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
