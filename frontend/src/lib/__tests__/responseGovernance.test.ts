/**
 * Tests for responseGovernance.ts
 */

import {
  runGovernance,
  getGovernanceViolations,
  clearGovernanceViolations,
  getGovernanceSummary,
  DEFAULT_POLICIES,
} from "../responseGovernance";
import type { StandardResponse, ResponseMeta } from "@/types/response";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResponse(overrides: Partial<StandardResponse> = {}): StandardResponse {
  return {
    success: true,
    status: "success",
    data: { id: "1" },
    meta: makeMeta(),
    ...overrides,
  };
}

function makeMeta(overrides: Partial<ResponseMeta> = {}): ResponseMeta {
  return {
    receivedAt: new Date().toISOString(),
    latencyMs: 120,
    statusCode: 200,
    requestPath: "/tournaments",
    requestMethod: "GET",
    traceId: "test-trace-1",
    retries: 0,
    cached: false,
    transformations: [],
    ...overrides,
  };
}

// ─── runGovernance ────────────────────────────────────────────────────────────

describe("runGovernance", () => {
  beforeEach(() => clearGovernanceViolations());

  it("returns no violations for a clean response", () => {
    const violations = runGovernance(makeResponse(), makeMeta());
    expect(violations).toHaveLength(0);
  });

  it("flags success-status mismatch (200 but success=false)", () => {
    const response = makeResponse({ success: false });
    const meta = makeMeta({ statusCode: 200 });
    const violations = runGovernance(response, meta);
    const mismatch = violations.find((v) => v.rule === "success-status-mismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe("warn");
  });

  it("flags rate limiting (429 status)", () => {
    const meta = makeMeta({ statusCode: 429 });
    const violations = runGovernance(makeResponse(), meta);
    const rl = violations.find((v) => v.rule === "rate-limit");
    expect(rl).toBeDefined();
  });

  it("flags latency threshold breach (>10s)", () => {
    const meta = makeMeta({ latencyMs: 12_000 });
    const violations = runGovernance(makeResponse(), meta);
    const latViolation = violations.find((v) => v.rule === "latency-threshold");
    expect(latViolation).toBeDefined();
    expect(latViolation?.severity).toBe("error");
  });

  it("records violations in the store", () => {
    const meta = makeMeta({ statusCode: 429 });
    runGovernance(makeResponse(), meta);
    const stored = getGovernanceViolations();
    expect(stored.length).toBeGreaterThan(0);
  });

  it("invokes onViolation callback for each violation", () => {
    const callback = jest.fn();
    const meta = makeMeta({ statusCode: 429 });
    runGovernance(makeResponse(), meta, { onViolation: callback });
    expect(callback).toHaveBeenCalled();
  });

  it("runs extra policies alongside defaults", () => {
    const customPolicy = {
      name: "custom-test-policy",
      severity: "warn" as const,
      validate: () => "Custom policy triggered",
    };
    const violations = runGovernance(makeResponse(), makeMeta(), {
      extraPolicies: [customPolicy],
    });
    const custom = violations.find((v) => v.rule === "custom-test-policy");
    expect(custom).toBeDefined();
    expect(custom?.message).toBe("Custom policy triggered");
  });

  it("does not throw on critical violations unless throwOnCritical is set", () => {
    const criticalPolicy = {
      name: "critical-test",
      severity: "critical" as const,
      validate: () => "Critical issue",
    };
    expect(() =>
      runGovernance(makeResponse(), makeMeta(), {
        extraPolicies: [criticalPolicy],
        throwOnCritical: false,
      }),
    ).not.toThrow();
  });

  it("throws on critical violations when throwOnCritical is true", () => {
    const criticalPolicy = {
      name: "critical-test-throw",
      severity: "critical" as const,
      validate: () => "Critical issue",
    };
    expect(() =>
      runGovernance(makeResponse(), makeMeta(), {
        extraPolicies: [criticalPolicy],
        throwOnCritical: true,
      }),
    ).toThrow("[ArenaX Governance]");
  });
});

// ─── getGovernanceSummary ─────────────────────────────────────────────────────

describe("getGovernanceSummary", () => {
  beforeEach(() => clearGovernanceViolations());

  it("returns zeroed summary when no violations exist", () => {
    const summary = getGovernanceSummary();
    expect(summary.totalViolations).toBe(0);
    expect(summary.bySeverity.warn).toBe(0);
    expect(summary.topOffendingEndpoints).toHaveLength(0);
  });

  it("aggregates violations by rule and severity", () => {
    // Trigger two rate-limit violations on different endpoints
    runGovernance(makeResponse(), makeMeta({ statusCode: 429, requestPath: "/matches" }));
    runGovernance(makeResponse(), makeMeta({ statusCode: 429, requestPath: "/tournaments" }));

    const summary = getGovernanceSummary();
    expect(summary.byRule["rate-limit"]).toBe(2);
    expect(summary.bySeverity.warn).toBeGreaterThanOrEqual(2);
  });

  it("lists top offending endpoints", () => {
    runGovernance(makeResponse(), makeMeta({ statusCode: 429, requestPath: "/matches" }));
    runGovernance(makeResponse(), makeMeta({ statusCode: 429, requestPath: "/matches" }));
    runGovernance(makeResponse(), makeMeta({ statusCode: 429, requestPath: "/tournaments" }));

    const summary = getGovernanceSummary();
    expect(summary.topOffendingEndpoints[0]?.endpoint).toBe("/matches");
    expect(summary.topOffendingEndpoints[0]?.count).toBe(2);
  });
});

// ─── DEFAULT_POLICIES list ────────────────────────────────────────────────────

describe("DEFAULT_POLICIES", () => {
  it("includes the expected built-in policies", () => {
    const names = DEFAULT_POLICIES.map((p) => p.name);
    expect(names).toContain("envelope-shape");
    expect(names).toContain("success-status-mismatch");
    expect(names).toContain("payload-size");
    expect(names).toContain("rate-limit");
    expect(names).toContain("latency-threshold");
  });
});
