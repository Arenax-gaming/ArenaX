/**
 * Unit tests for the nonce-based CSP helpers (#1091).
 */

import { buildContentSecurityPolicy, cspHeaderName, generateNonce } from "@/lib/csp";

describe("generateNonce", () => {
  it("returns a non-empty base64 string", () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
    expect(() => atob(nonce)).not.toThrow();
  });

  it("is different on every call (per-request, not cached)", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});

describe("buildContentSecurityPolicy", () => {
  it("embeds the nonce in script-src", () => {
    const csp = buildContentSecurityPolicy("abc123");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("never allows 'unsafe-inline' or 'unsafe-eval' for scripts", () => {
    const csp = buildContentSecurityPolicy("abc123");
    const scriptSrcLine = csp.split(";").find((line) => line.trim().startsWith("script-src"));
    expect(scriptSrcLine).toBeDefined();
    expect(scriptSrcLine).not.toContain("unsafe-inline");
    expect(scriptSrcLine).not.toContain("unsafe-eval");
  });

  it("still restricts frame-ancestors and object-src", () => {
    const csp = buildContentSecurityPolicy("abc123");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });
});

describe("cspHeaderName", () => {
  it("uses report-only in development", () => {
    expect(cspHeaderName(true)).toBe("Content-Security-Policy-Report-Only");
  });

  it("enforces in production", () => {
    expect(cspHeaderName(false)).toBe("Content-Security-Policy");
  });
});
