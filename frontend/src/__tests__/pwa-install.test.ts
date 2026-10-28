/**
 * Install-prompt suppression and cohorts (Issue #858).
 *
 * The 30-day window is the part users feel: getting the banner again the day
 * after dismissing it is what trains people to ignore it.
 */

import {
  DISMISSAL_DAYS,
  clearPromptSuppression,
  getPwaCohort,
  isPromptSuppressed,
  suppressPromptAfterDismissal,
} from "@/lib/pwaInstall";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("prompt suppression", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not suppress a prompt that has never been dismissed", () => {
    expect(isPromptSuppressed()).toBe(false);
  });

  it("suppresses for thirty days after a dismissal", () => {
    const now = Date.UTC(2026, 0, 1);
    suppressPromptAfterDismissal(now);

    expect(isPromptSuppressed(now)).toBe(true);
    expect(isPromptSuppressed(now + 29 * DAY_MS)).toBe(true);
  });

  it("stops suppressing once the window has passed", () => {
    const now = Date.UTC(2026, 0, 1);
    suppressPromptAfterDismissal(now);

    expect(isPromptSuppressed(now + DISMISSAL_DAYS * DAY_MS + 1)).toBe(false);
  });

  it("ignores a corrupt stored value rather than suppressing forever", () => {
    window.localStorage.setItem("arenax:pwa:dismissed-until", "not-a-number");
    expect(isPromptSuppressed()).toBe(false);
  });

  it("can be cleared", () => {
    const now = Date.UTC(2026, 0, 1);
    suppressPromptAfterDismissal(now);
    clearPromptSuppression();
    expect(isPromptSuppressed(now)).toBe(false);
  });
});

describe("cohort assignment", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("is stable across calls", () => {
    const first = getPwaCohort();
    expect(getPwaCohort()).toBe(first);
    expect(getPwaCohort()).toBe(first);
  });

  it("is one of the known cohorts", () => {
    expect(["benefits", "speed"]).toContain(getPwaCohort());
  });

  it("reassigns when the stored value is not a known cohort", () => {
    window.localStorage.setItem("arenax:pwa:cohort", "legacy-variant");
    expect(["benefits", "speed"]).toContain(getPwaCohort());
  });
});

// ── Custom install flow (#1414) ──────────────────────────────────────────────

import { getLastInstallOutcome, recordInstallOutcome } from "@/lib/pwaInstall";
import { isIosDevice, isIosSafari } from "@/hooks/usePWAInstall";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
const IPADOS_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

describe("install platform detection", () => {
  it("treats iPhone and touch-enabled iPadOS as iOS", () => {
    expect(isIosDevice(IPHONE_SAFARI, 5)).toBe(true);
    expect(isIosDevice(IPADOS_DESKTOP_UA, 5)).toBe(true);
    expect(isIosDevice(IPADOS_DESKTOP_UA, 0)).toBe(false);
    expect(isIosDevice(ANDROID_CHROME, 5)).toBe(false);
  });

  it("distinguishes Safari from other iOS browsers", () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
  });
});

describe("install outcome", () => {
  beforeEach(() => window.localStorage.clear());

  it("records the user's choice", () => {
    expect(getLastInstallOutcome()).toBeNull();
    recordInstallOutcome("dismissed", 1234);
    expect(getLastInstallOutcome()).toEqual({ outcome: "dismissed", at: 1234 });
  });

  it("ignores corrupt stored values", () => {
    window.localStorage.setItem("arenax:pwa:last-outcome", "{not json");
    expect(getLastInstallOutcome()).toBeNull();
  });
});
