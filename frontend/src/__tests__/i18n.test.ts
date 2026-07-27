/**
 * Comprehensive i18n test suite for ArenaX (Issue #696)
 *
 * Covers:
 *  - routing: supported locales, RTL detection, labels
 *  - locale detection: localStorage → URL param → navigator → fallback
 *  - monitoring: missing key reporting, locale change tracking
 *  - translation completeness: all locales share the same key structure
 */

import { routing, RTL_LOCALES, LOCALE_LABELS, LOCALE_BCP47, type Locale } from "@/i18n/routing";
import {
  detectLocale,
  detectFromAcceptLanguage,
  persistLocale,
  clearPersistedLocale,
  LOCALE_STORAGE_KEY,
} from "@/i18n/localeDetection";
import {
  reportMissingKey,
  getMissingKeys,
  clearMissingKeys,
  trackLocaleChange,
  getLocaleHistory,
  clearLocaleHistory,
} from "@/i18n/monitoring";

// ─── Load translation files ───────────────────────────────────────────────────

import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import yoMessages from "@/messages/yo.json";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively collect all dot-notation key paths in an object. */
function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const full = prefix ? `${prefix}.${k}` : k;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? collectKeys(v as Record<string, unknown>, full)
      : [full];
  });
}

// ─── 1. Routing configuration ─────────────────────────────────────────────────

describe("i18n routing configuration", () => {
  it("includes the five expected locales", () => {
    expect(routing.locales).toEqual(["en", "es", "ar", "fr", "yo"]);
  });

  it("has 'en' as default locale", () => {
    expect(routing.defaultLocale).toBe("en");
  });

  it("marks only Arabic as RTL", () => {
    expect(RTL_LOCALES).toContain("ar");
    (["en", "es", "fr", "yo"] as Locale[]).forEach((l) => {
      expect(RTL_LOCALES).not.toContain(l);
    });
  });

  it("provides a human-readable label for every locale", () => {
    routing.locales.forEach((locale) => {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
    });
  });

  it("provides a BCP-47 tag for every locale", () => {
    routing.locales.forEach((locale) => {
      expect(LOCALE_BCP47[locale]).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/);
    });
  });
});

// ─── 2. Locale detection ──────────────────────────────────────────────────────

describe("detectLocale()", () => {
  // Reset mocks before each test
  beforeEach(() => {
    clearPersistedLocale();
    // Clean navigator language mock
    Object.defineProperty(navigator, "language", {
      value: "en-US",
      writable: true,
      configurable: true,
    });
    Object.defineProperty(navigator, "languages", {
      value: ["en-US"],
      writable: true,
      configurable: true,
    });
  });

  describe("1st priority — localStorage", () => {
    it("returns the stored locale if valid", () => {
      localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
      expect(detectLocale()).toBe("fr");
    });

    it("ignores an invalid stored value", () => {
      localStorage.setItem(LOCALE_STORAGE_KEY, "zz");
      // Should fall through to navigator or default
      const detected = detectLocale();
      expect(routing.locales).toContain(detected);
    });

    it("is case-insensitive", () => {
      localStorage.setItem(LOCALE_STORAGE_KEY, "FR");
      expect(detectLocale()).toBe("fr");
    });
  });

  describe("2nd priority — URL ?lang= param", () => {
    it("picks up a valid ?lang= parameter", () => {
      clearPersistedLocale(); // ensure storage doesn't interfere
      const params = new URLSearchParams("lang=es");
      expect(detectLocale(params)).toBe("es");
    });

    it("ignores an unsupported ?lang= parameter", () => {
      clearPersistedLocale();
      const params = new URLSearchParams("lang=xx");
      const result = detectLocale(params);
      // Should not return "xx"
      expect(routing.locales).toContain(result);
    });

    it("handles yo locale via URL param", () => {
      clearPersistedLocale();
      const params = new URLSearchParams("lang=yo");
      expect(detectLocale(params)).toBe("yo");
    });
  });

  describe("3rd priority — navigator.language", () => {
    it("returns 'es' for navigator.language='es-419'", () => {
      clearPersistedLocale();
      Object.defineProperty(navigator, "language", {
        value: "es-419",
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "languages", {
        value: ["es-419"],
        writable: true,
        configurable: true,
      });
      expect(detectLocale()).toBe("es");
    });

    it("returns 'ar' for navigator.language='ar-EG'", () => {
      clearPersistedLocale();
      Object.defineProperty(navigator, "language", {
        value: "ar-EG",
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "languages", {
        value: ["ar-EG"],
        writable: true,
        configurable: true,
      });
      expect(detectLocale()).toBe("ar");
    });

    it("falls through to default for unsupported browser language", () => {
      clearPersistedLocale();
      Object.defineProperty(navigator, "language", {
        value: "de-DE",
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "languages", {
        value: ["de-DE"],
        writable: true,
        configurable: true,
      });
      expect(detectLocale()).toBe("en");
    });
  });

  describe("4th priority — fallback to 'en'", () => {
    it("returns 'en' when nothing else matches", () => {
      clearPersistedLocale();
      Object.defineProperty(navigator, "language", {
        value: "zz",
        writable: true,
        configurable: true,
      });
      Object.defineProperty(navigator, "languages", {
        value: [],
        writable: true,
        configurable: true,
      });
      expect(detectLocale()).toBe("en");
    });
  });
});

describe("persistLocale() / clearPersistedLocale()", () => {
  it("stores and retrieves a locale", () => {
    persistLocale("yo");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("yo");
  });

  it("clears the stored locale", () => {
    persistLocale("fr");
    clearPersistedLocale();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });
});

describe("detectFromAcceptLanguage()", () => {
  it("parses a standard Accept-Language header", () => {
    expect(detectFromAcceptLanguage("fr-CH, fr;q=0.9, en;q=0.8")).toBe("fr");
  });

  it("falls back to 'en' for unmatched header", () => {
    expect(detectFromAcceptLanguage("de;q=1.0, it;q=0.9")).toBe("en");
  });

  it("handles null / undefined gracefully", () => {
    expect(detectFromAcceptLanguage(null)).toBe("en");
    expect(detectFromAcceptLanguage(undefined)).toBe("en");
  });

  it("handles empty string", () => {
    expect(detectFromAcceptLanguage("")).toBe("en");
  });

  it("respects quality values", () => {
    // ar has q=0.5, es has q=0.8 — should pick es
    expect(detectFromAcceptLanguage("ar;q=0.5, es;q=0.8")).toBe("es");
  });
});

// ─── 3. Monitoring ────────────────────────────────────────────────────────────

describe("i18n monitoring — missing key reporting", () => {
  beforeEach(() => clearMissingKeys());

  it("records a missing key", () => {
    reportMissingKey("en", "auth", "missingButton");
    const keys = getMissingKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      locale: "en",
      namespace: "auth",
      key: "missingButton",
      count: 1,
    });
  });

  it("increments count for repeated missing key", () => {
    reportMissingKey("es", "common", "ghost");
    reportMissingKey("es", "common", "ghost");
    reportMissingKey("es", "common", "ghost");
    const keys = getMissingKeys();
    expect(keys[0].count).toBe(3);
  });

  it("tracks different missing keys separately", () => {
    reportMissingKey("en", "gameplay", "keyA");
    reportMissingKey("en", "gameplay", "keyB");
    expect(getMissingKeys()).toHaveLength(2);
  });

  it("clears all records", () => {
    reportMissingKey("en", "settings", "temp");
    clearMissingKeys();
    expect(getMissingKeys()).toHaveLength(0);
  });

  it("sorts by most-recent first", () => {
    jest.useFakeTimers();
    jest.setSystemTime(1000);
    reportMissingKey("en", "nav", "first");
    jest.setSystemTime(2000);
    reportMissingKey("en", "nav", "second");
    jest.useRealTimers();

    const keys = getMissingKeys();
    expect(keys[0].key).toBe("second");
    expect(keys[1].key).toBe("first");
  });
});

describe("i18n monitoring — locale change tracking", () => {
  beforeEach(() => clearLocaleHistory());

  it("records a locale change", () => {
    trackLocaleChange("en", "fr", "user");
    const history = getLocaleHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: "en", to: "fr", source: "user" });
  });

  it("records a null → locale transition (first load)", () => {
    trackLocaleChange(null, "yo", "auto-detect");
    expect(getLocaleHistory()[0]).toMatchObject({ from: null, to: "yo" });
  });

  it("records multiple changes", () => {
    trackLocaleChange("en", "es", "user");
    trackLocaleChange("es", "ar", "url-param");
    expect(getLocaleHistory()).toHaveLength(2);
  });

  it("keeps history with most-recent entry first", () => {
    trackLocaleChange("en", "fr", "user");
    trackLocaleChange("fr", "es", "user");
    const history = getLocaleHistory();
    expect(history[0].to).toBe("es");
    expect(history[1].to).toBe("fr");
  });

  it("caps history at 50 entries", () => {
    for (let i = 0; i < 60; i++) {
      trackLocaleChange("en", "fr", "user");
    }
    expect(getLocaleHistory()).toHaveLength(50);
  });
});

// ─── 4. Translation completeness ─────────────────────────────────────────────

describe("Translation file completeness", () => {
  const allMessages: Record<string, Record<string, unknown>> = {
    en: enMessages,
    es: esMessages,
    fr: frMessages,
    ar: arMessages,
    yo: yoMessages,
  };

  const enKeys = collectKeys(enMessages as Record<string, unknown>);

  it("English messages have at least 100 keys", () => {
    expect(enKeys.length).toBeGreaterThan(100);
  });

  // Check every supported locale
  (["es", "fr", "ar", "yo"] as const).forEach((locale) => {
    describe(`${LOCALE_LABELS[locale]} (${locale})`, () => {
      const localeMessages = allMessages[locale] as Record<string, unknown>;
      const localeKeys = collectKeys(localeMessages);

      it("has the same top-level namespaces as English", () => {
        const enNamespaces = Object.keys(enMessages);
        const localeNamespaces = Object.keys(localeMessages);
        expect(localeNamespaces.sort()).toEqual(enNamespaces.sort());
      });

      it("contains all keys defined in English", () => {
        const missing = enKeys.filter((k) => !localeKeys.includes(k));
        if (missing.length > 0) {
          console.warn(
            `[i18n] ${locale} is missing ${missing.length} keys:`,
            missing.slice(0, 10)
          );
        }
        expect(missing).toHaveLength(0);
      });

      it("has no extra keys not present in English", () => {
        const extra = localeKeys.filter((k) => !enKeys.includes(k));
        expect(extra).toHaveLength(0);
      });
    });
  });
});

// ─── 5. Message structure validation ─────────────────────────────────────────

describe("Message structure validation", () => {
  it("en.json has expected namespaces", () => {
    const expected = [
      "common",
      "nav",
      "auth",
      "gameplay",
      "tournaments",
      "leaderboard",
      "wallet",
      "profile",
      "settings",
      "errors",
      "date",
      "achievements",
      "notifications",
      "accessibility",
    ];
    expected.forEach((ns) => {
      expect(enMessages).toHaveProperty(ns);
    });
  });

  it("en.common has core UI strings", () => {
    const common = enMessages.common as Record<string, string>;
    ["home", "login", "register", "logout", "save", "cancel"].forEach((k) => {
      expect(common[k]).toBeTruthy();
    });
  });

  it("en.auth has login and registration strings", () => {
    const auth = enMessages.auth as Record<string, string>;
    ["loginButton", "registerButton", "emailLabel", "passwordLabel"].forEach(
      (k) => {
        expect(auth[k]).toBeTruthy();
      }
    );
  });

  it("en.errors has fallback error strings", () => {
    const errors = enMessages.errors as Record<string, string>;
    ["title", "generic", "network", "notFound", "serverError"].forEach((k) => {
      expect(errors[k]).toBeTruthy();
    });
  });

  it("en.settings includes language-switching keys", () => {
    const settings = enMessages.settings as Record<string, string>;
    expect(settings.language).toBeTruthy();
    expect(settings.selectLanguage).toBeTruthy();
  });
});
