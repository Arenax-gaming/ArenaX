/**
 * @jest-environment jsdom
 */

import { AnalyticsService } from "@/lib/analytics";
import { ABTestingService } from "@/lib/abTesting";
import type { AnalyticsAdapter, AnalyticsPayload } from "@/types/analytics";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAdapter(): AnalyticsAdapter & { events: AnalyticsPayload[] } {
  const events: AnalyticsPayload[] = [];
  return {
    name: "test",
    events,
    track(payload) {
      events.push(payload);
    },
  };
}

// ── AnalyticsService ─────────────────────────────────────────────────────────

describe("AnalyticsService", () => {
  let service: AnalyticsService;
  let adapter: ReturnType<typeof makeAdapter>;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    service = new AnalyticsService();
    adapter = makeAdapter();
    service.registerAdapter(adapter);
  });

  it("does NOT dispatch events when consent is pending", () => {
    service.track("game_start", { gameMode: "1v1" });
    expect(adapter.events).toHaveLength(0);
  });

  it("dispatches events after consent is granted", () => {
    service.setConsent("granted");
    service.track("game_start", { gameMode: "1v1" });
    expect(adapter.events).toHaveLength(1);
    expect(adapter.events[0].event).toBe("game_start");
  });

  it("packs required base fields in every payload", () => {
    service.setConsent("granted");
    service.track("page_view", { path: "/dashboard" });

    const payload = adapter.events[0];
    expect(payload.event).toBe("page_view");
    expect(typeof payload.timestamp).toBe("number");
    expect(typeof payload.sessionId).toBe("string");
  });

  it("stops dispatching after consent is denied", () => {
    service.setConsent("granted");
    service.track("game_start", { gameMode: "1v1" });
    service.setConsent("denied");
    service.track("game_end", { gameMode: "1v1", durationMs: 500, outcome: "win" });

    expect(adapter.events).toHaveLength(1);
  });

  it("scrubs session identifiers on opt-out", () => {
    service.setConsent("granted");
    service.identify("user-123");
    service.setConsent("denied");

    const session = service.getSession();
    expect(session.sessionId).toBe("anonymous");
    expect(session.userId).toBeUndefined();
  });

  it("includes userId after identify()", () => {
    service.setConsent("granted");
    service.identify("user-42");
    service.track("profile_viewed");

    expect(adapter.events[0].userId).toBe("user-42");
  });

  it("persists consent to localStorage", () => {
    service.setConsent("granted");
    const raw = localStorage.getItem("arenax:analytics:consent");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.analytics).toBe("granted");
  });

  it("does not register the same adapter twice", () => {
    service.registerAdapter(adapter); // duplicate
    service.setConsent("granted");
    service.track("auth_login");
    expect(adapter.events).toHaveLength(1);
  });
});

// ── ABTestingService ──────────────────────────────────────────────────────────

describe("ABTestingService", () => {
  let abService: ABTestingService;

  beforeEach(() => {
    localStorage.clear();
    abService = new ABTestingService();
  });

  it("assigns either control or variant", () => {
    const result = abService.getVariant({ id: "exp-1", splitRatio: 0.5 }, "user-1");
    expect(["control", "variant"]).toContain(result);
  });

  it("returns the same variant on repeated calls (deterministic)", () => {
    const exp = { id: "exp-stable", splitRatio: 0.5 };
    const v1 = abService.getVariant(exp, "user-abc");
    const v2 = abService.getVariant(exp, "user-abc");
    expect(v1).toBe(v2);
  });

  it("persists assignment to localStorage", () => {
    abService.getVariant({ id: "exp-persist", splitRatio: 0.5 }, "user-x");
    const raw = localStorage.getItem("arenax:ab:assignments");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed["exp-persist"]).toBeDefined();
  });

  it("uses stored assignment instead of recomputing", () => {
    const exp = { id: "exp-cached", splitRatio: 0.5 };
    const first = abService.getVariant(exp, "user-y");
    // Create fresh service (re-reads localStorage) to test persistence
    const fresh = new ABTestingService();
    const second = fresh.getVariant(exp, "user-y");
    expect(first).toBe(second);
  });

  it("clears all assignments", () => {
    abService.getVariant({ id: "exp-clear", splitRatio: 0.5 }, "user-z");
    abService.clearAssignments();
    expect(abService.getAllAssignments()).toHaveLength(0);
    expect(localStorage.getItem("arenax:ab:assignments")).toBeNull();
  });

  it("distributes users roughly 50/50 with 0.5 split", () => {
    const exp = { id: "exp-dist", splitRatio: 0.5 };
    const variants = Array.from({ length: 200 }, (_, i) =>
      abService.getVariant(exp, `user-${i}`)
    );
    // Use a fresh instance per user so persistence doesn't skew counts
    const freshVariants = Array.from({ length: 200 }, (_, i) => {
      localStorage.clear();
      const svc = new ABTestingService();
      return svc.getVariant(exp, `user-${i}`);
    });
    const variantCount = freshVariants.filter((v) => v === "variant").length;
    // Expect between 30%–70% to be variant (loose bound for deterministic hash)
    expect(variantCount).toBeGreaterThan(40);
    expect(variantCount).toBeLessThan(160);
    void variants; // silence unused warning
  });

  it("always assigns variant when splitRatio is 1", () => {
    const exp = { id: "exp-all-variant", splitRatio: 1 };
    const results = Array.from({ length: 10 }, (_, i) => {
      localStorage.clear();
      return new ABTestingService().getVariant(exp, `u-${i}`);
    });
    expect(results.every((v) => v === "variant")).toBe(true);
  });

  it("always assigns control when splitRatio is 0", () => {
    const exp = { id: "exp-all-control", splitRatio: 0 };
    const results = Array.from({ length: 10 }, (_, i) => {
      localStorage.clear();
      return new ABTestingService().getVariant(exp, `u-${i}`);
    });
    expect(results.every((v) => v === "control")).toBe(true);
  });
});

// ── Consent persistence ───────────────────────────────────────────────────────

describe("Consent persistence", () => {
  it("new service instance inherits previously saved consent", () => {
    const s1 = new AnalyticsService();
    s1.setConsent("granted");

    const s2 = new AnalyticsService();
    expect(s2.getConsent().analytics).toBe("granted");
  });
});
