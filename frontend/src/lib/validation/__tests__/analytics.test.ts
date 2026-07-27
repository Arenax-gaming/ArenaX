/**
 * Tests for validation analytics and governance.
 */

import {
  recordValidationAttempt,
  getValidationEvents,
  getValidationViolations,
  getSchemaStats,
  getValidationSnapshot,
  auditSuccessRates,
  clearValidationAnalytics,
  registerGovernancePolicy,
  type ValidationAttemptEvent,
} from "../analytics";

beforeEach(() => {
  clearValidationAnalytics();
});

// ─── recordValidationAttempt ──────────────────────────────────────────────────

describe("recordValidationAttempt()", () => {
  it("stores the event in the analytics store", () => {
    recordValidationAttempt(makeEvent({ schemaName: "login", success: true }));
    const events = getValidationEvents();
    expect(events.length).toBe(1);
    expect(events[0]?.schemaName).toBe("login");
    expect(events[0]?.success).toBe(true);
  });

  it("stores failure events with failedFields", () => {
    recordValidationAttempt(
      makeEvent({ schemaName: "register", success: false, failedFields: ["email", "username"] }),
    );
    const events = getValidationEvents();
    expect(events[0]?.failedFields).toContain("email");
    expect(events[0]?.failedFields).toContain("username");
  });

  it("inserts newest events at the front", () => {
    recordValidationAttempt(makeEvent({ schemaName: "first" }));
    recordValidationAttempt(makeEvent({ schemaName: "second" }));
    const events = getValidationEvents();
    expect(events[0]?.schemaName).toBe("second");
    expect(events[1]?.schemaName).toBe("first");
  });
});

// ─── getSchemaStats ───────────────────────────────────────────────────────────

describe("getSchemaStats()", () => {
  it("returns zero stats for unknown schema", () => {
    const stats = getSchemaStats("nonexistent");
    expect(stats.totalAttempts).toBe(0);
    expect(stats.successRate).toBe(1);
  });

  it("computes correct success rate", () => {
    recordValidationAttempt(makeEvent({ schemaName: "test", success: true }));
    recordValidationAttempt(makeEvent({ schemaName: "test", success: true }));
    recordValidationAttempt(makeEvent({ schemaName: "test", success: false, failedFields: ["email"] }));

    const stats = getSchemaStats("test");
    expect(stats.totalAttempts).toBe(3);
    expect(stats.successCount).toBe(2);
    expect(stats.failureCount).toBe(1);
    expect(stats.successRate).toBeCloseTo(2 / 3);
  });

  it("lists failing fields in fieldStats", () => {
    recordValidationAttempt(
      makeEvent({ schemaName: "test", success: false, failedFields: ["email", "password"] }),
    );
    const stats = getSchemaStats("test");
    const fields = stats.fieldStats.map((f) => f.field);
    expect(fields).toContain("email");
    expect(fields).toContain("password");
  });

  it("sorts fieldStats by failure count descending", () => {
    recordValidationAttempt(makeEvent({ schemaName: "test", success: false, failedFields: ["email"] }));
    recordValidationAttempt(makeEvent({ schemaName: "test", success: false, failedFields: ["email"] }));
    recordValidationAttempt(makeEvent({ schemaName: "test", success: false, failedFields: ["email", "password"] }));

    const stats = getSchemaStats("test");
    expect(stats.fieldStats[0]?.field).toBe("email");
    expect(stats.fieldStats[0]?.failureCount).toBe(3);
  });
});

// ─── getValidationSnapshot ────────────────────────────────────────────────────

describe("getValidationSnapshot()", () => {
  it("returns zeroed snapshot when no events", () => {
    const snap = getValidationSnapshot();
    expect(snap.totalAttempts).toBe(0);
    expect(snap.globalSuccessRate).toBe(1);
    expect(snap.bySchema).toHaveLength(0);
  });

  it("aggregates across multiple schemas", () => {
    recordValidationAttempt(makeEvent({ schemaName: "login", success: true }));
    recordValidationAttempt(makeEvent({ schemaName: "register", success: false, failedFields: ["email"] }));

    const snap = getValidationSnapshot();
    expect(snap.totalAttempts).toBe(2);
    expect(snap.totalSuccesses).toBe(1);
    expect(snap.totalFailures).toBe(1);
    expect(snap.bySchema.length).toBe(2);
  });

  it("includes topFailingFields", () => {
    recordValidationAttempt(makeEvent({ schemaName: "test", success: false, failedFields: ["email"] }));
    recordValidationAttempt(makeEvent({ schemaName: "test", success: false, failedFields: ["email", "password"] }));

    const snap = getValidationSnapshot();
    const emailField = snap.topFailingFields.find((f) => f.field === "email");
    expect(emailField).toBeDefined();
    expect(emailField!.failureCount).toBe(2);
  });
});

// ─── auditSuccessRates ────────────────────────────────────────────────────────

describe("auditSuccessRates()", () => {
  it("returns no violations when success rate is above threshold", () => {
    for (let i = 0; i < 5; i++) {
      recordValidationAttempt(makeEvent({ schemaName: "high-rate", success: true }));
    }
    const violations = auditSuccessRates(0.3);
    expect(violations.filter((v) => v.schemaName === "high-rate")).toHaveLength(0);
  });

  it("returns a violation when success rate is below threshold", () => {
    for (let i = 0; i < 4; i++) {
      recordValidationAttempt(makeEvent({ schemaName: "low-rate", success: false, failedFields: ["x"] }));
    }
    recordValidationAttempt(makeEvent({ schemaName: "low-rate", success: true }));

    const violations = auditSuccessRates(0.5);
    const v = violations.find((v) => v.schemaName === "low-rate");
    expect(v).toBeDefined();
    expect(v?.policy).toBe("low-success-rate");
  });

  it("requires at least 5 attempts before flagging", () => {
    recordValidationAttempt(makeEvent({ schemaName: "few-attempts", success: false, failedFields: ["x"] }));
    const violations = auditSuccessRates(0.3);
    expect(violations.filter((v) => v.schemaName === "few-attempts")).toHaveLength(0);
  });
});

// ─── Governance: slow validation policy ──────────────────────────────────────

describe("slow validation governance policy", () => {
  it("records a governance violation when durationMs > 100", () => {
    recordValidationAttempt(makeEvent({ schemaName: "slow", durationMs: 200 }));
    const violations = getValidationViolations();
    const v = violations.find(
      (v) => v.policy === "slow-validation" && v.schemaName === "slow",
    );
    expect(v).toBeDefined();
  });

  it("does not record a violation for fast validation", () => {
    recordValidationAttempt(makeEvent({ schemaName: "fast", durationMs: 5 }));
    const violations = getValidationViolations();
    expect(violations.filter((v) => v.policy === "slow-validation" && v.schemaName === "fast")).toHaveLength(0);
  });
});

// ─── Custom governance policy ─────────────────────────────────────────────────

describe("registerGovernancePolicy()", () => {
  it("runs a registered custom policy on each event", () => {
    const triggered: string[] = [];
    registerGovernancePolicy({
      name: "test-custom-policy",
      description: "Test policy",
      severity: "info",
      check(event) {
        if (event.schemaName === "custom-test-schema") {
          triggered.push(event.schemaName);
        }
        return null;
      },
    });

    recordValidationAttempt(makeEvent({ schemaName: "custom-test-schema" }));
    expect(triggered).toContain("custom-test-schema");
  });

  it("does not duplicate the same policy on re-registration", () => {
    let callCount = 0;
    const policy = {
      name: "dedup-policy",
      description: "",
      severity: "info" as const,
      check() { callCount++; return null; },
    };
    registerGovernancePolicy(policy);
    registerGovernancePolicy(policy); // second registration should be ignored
    recordValidationAttempt(makeEvent({ schemaName: "dedup-test" }));
    expect(callCount).toBe(1);
  });
});

// ─── clearValidationAnalytics ─────────────────────────────────────────────────

describe("clearValidationAnalytics()", () => {
  it("empties the event and violation stores", () => {
    recordValidationAttempt(makeEvent({ schemaName: "x", durationMs: 200 }));
    clearValidationAnalytics();
    expect(getValidationEvents()).toHaveLength(0);
    expect(getValidationViolations()).toHaveLength(0);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<ValidationAttemptEvent> = {}): ValidationAttemptEvent {
  return {
    schemaName: "default",
    success: true,
    failedFields: [],
    durationMs: 5,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}
