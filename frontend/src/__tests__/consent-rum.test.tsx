/**
 * Unit tests for granular consent gating (#1093).
 *
 * Covers:
 *  - RumProvider does not call datadogRum.init() when analytics consent is
 *    false (the primary acceptance-criteria test)
 *  - RumProvider does call datadogRum.init() once analytics consent is granted
 *  - saveConsentPreferences persists to localStorage under arenax_consent_v1
 *  - hasConsentedTo reads per-category choices, defaulting to false until decided
 */

import React from "react";
import { render } from "@testing-library/react";

const mockInit = jest.fn();
const mockStopSession = jest.fn();
const mockClearUser = jest.fn();

jest.mock(
  "@datadog/browser-rum",
  () => ({
    datadogRum: {
      init: (...args: unknown[]) => mockInit(...args),
      stopSession: (...args: unknown[]) => mockStopSession(...args),
      clearUser: (...args: unknown[]) => mockClearUser(...args),
      getInitConfiguration: jest.fn(() => undefined),
    },
  }),
  { virtual: true },
);

import { RumProvider } from "@/components/providers/RumProvider";
import {
  CONSENT_STORAGE_KEY,
  getConsentPreferences,
  hasConsentedTo,
  saveConsentPreferences,
} from "@/lib/consentPreferences";

beforeEach(() => {
  mockInit.mockClear();
  mockStopSession.mockClear();
  mockClearUser.mockClear();
  localStorage.clear();
});

describe("consent gating — RumProvider (#1093)", () => {
  it("does not call datadogRum.init() when analytics consent is false", () => {
    saveConsentPreferences({ analytics: false, performance: false, personalisation: false });

    render(
      <RumProvider>
        <div>child</div>
      </RumProvider>,
    );

    expect(mockInit).not.toHaveBeenCalled();
  });

  it("does not call datadogRum.init() before the user has made any choice", () => {
    // No saveConsentPreferences call at all — hasDecided is false.
    render(
      <RumProvider>
        <div>child</div>
      </RumProvider>,
    );

    expect(mockInit).not.toHaveBeenCalled();
  });

  it("calls datadogRum.init() once analytics consent is granted", () => {
    saveConsentPreferences({ analytics: true });

    render(
      <RumProvider>
        <div>child</div>
      </RumProvider>,
    );

    expect(mockInit).toHaveBeenCalledTimes(1);
  });
});

describe("consentPreferences (#1093)", () => {
  it("persists choices to localStorage under arenax_consent_v1", () => {
    saveConsentPreferences({ performance: true, analytics: false, personalisation: true });

    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.choices).toEqual(
      expect.objectContaining({ performance: true, analytics: false, personalisation: true }),
    );
    expect(parsed.hasDecided).toBe(true);
  });

  it("hasConsentedTo defaults every non-essential category to false until decided", () => {
    expect(hasConsentedTo("essential")).toBe(true);
    expect(hasConsentedTo("performance")).toBe(false);
    expect(hasConsentedTo("analytics")).toBe(false);
    expect(hasConsentedTo("personalisation")).toBe(false);
  });

  it("hasConsentedTo reflects saved per-category choices", () => {
    saveConsentPreferences({ personalisation: true });
    expect(hasConsentedTo("personalisation")).toBe(true);
    expect(hasConsentedTo("analytics")).toBe(false);
  });

  it("getConsentPreferences merges partial saves onto existing choices", () => {
    saveConsentPreferences({ analytics: true });
    saveConsentPreferences({ performance: true });

    const prefs = getConsentPreferences();
    expect(prefs.choices.analytics).toBe(true);
    expect(prefs.choices.performance).toBe(true);
    expect(prefs.choices.personalisation).toBe(false);
  });
});
