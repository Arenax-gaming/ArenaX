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
