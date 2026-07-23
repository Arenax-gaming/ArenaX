/**
 * Style system unit tests — Issue #699
 *
 * Covers:
 * - lib/theme.ts: token(), css(), cssmerge(), responsive(),
 *   getBreakpoint(), isAtLeast(), isBelow(),
 *   applyAccentColor(), applyCompactMode(), applyAnimationsEnabled(),
 *   style analytics (trackStyleEvent, getStyleEvents, getStyleSummary, clearStyleEvents)
 * - hooks/useResponsive: getBreakpointFromWidth behaviour
 * - CSS token typing — no runtime errors on valid tokens
 */

import {
  token,
  css,
  cssmerge,
  responsive,
  getBreakpoint,
  isAtLeast,
  isBelow,
  BREAKPOINTS,
  applyAccentColor,
  applyCompactMode,
  applyAnimationsEnabled,
  getAccentColor,
  trackStyleEvent,
  getStyleEvents,
  getStyleSummary,
  clearStyleEvents,
  ACCENT_HSL,
  type DesignToken,
  type Breakpoint,
} from "@/lib/theme";

// ─── Setup ────────────────────────────────────────────────────────────────────

// jsdom doesn't implement ResizeObserver — stub it
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// ─────────────────────────────────────────────────────────────────────────────
// token()
// ─────────────────────────────────────────────────────────────────────────────

describe("token()", () => {
  it("wraps a token name in var()", () => {
    expect(token("--primary")).toBe("var(--primary)");
  });

  it("works for all common tokens", () => {
    const tokens: DesignToken[] = [
      "--background", "--foreground", "--primary", "--destructive",
      "--border", "--radius", "--shadow-md", "--duration-normal",
      "--z-modal", "--space-4",
    ];
    tokens.forEach((t) => expect(token(t)).toBe(`var(${t})`));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// css()
// ─────────────────────────────────────────────────────────────────────────────

describe("css()", () => {
  it("returns the object unchanged as a CSSProperties", () => {
    const result = css({ color: "red", padding: "1rem" });
    expect(result).toEqual({ color: "red", padding: "1rem" });
  });

  it("accepts token() values", () => {
    const result = css({ color: token("--primary") });
    expect(result.color).toBe("var(--primary)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cssmerge()
// ─────────────────────────────────────────────────────────────────────────────

describe("cssmerge()", () => {
  it("merges two style objects, later wins on conflict", () => {
    const a = css({ color: "red",  padding: "1rem" });
    const b = css({ color: "blue", margin: "2rem"  });
    const merged = cssmerge(a, b);
    expect(merged.color).toBe("blue");
    expect(merged.padding).toBe("1rem");
    expect(merged.margin).toBe("2rem");
  });

  it("ignores falsy entries", () => {
    const a = css({ color: "red" });
    const result = cssmerge(a, null, undefined, false);
    expect(result.color).toBe("red");
  });

  it("returns an empty object when called with no arguments", () => {
    expect(cssmerge()).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BREAKPOINTS
// ─────────────────────────────────────────────────────────────────────────────

describe("BREAKPOINTS", () => {
  it("defines all expected breakpoints", () => {
    expect(BREAKPOINTS.xs).toBe(375);
    expect(BREAKPOINTS.sm).toBe(640);
    expect(BREAKPOINTS.md).toBe(768);
    expect(BREAKPOINTS.lg).toBe(1024);
    expect(BREAKPOINTS.xl).toBe(1280);
    expect(BREAKPOINTS["2xl"]).toBe(1400);
  });

  it("breakpoints are in ascending order", () => {
    const values = Object.values(BREAKPOINTS) as number[];
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBreakpoint() / isAtLeast() / isBelow()
// ─────────────────────────────────────────────────────────────────────────────

describe("getBreakpoint()", () => {
  const setWidth = (w: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  };

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  });

  it("returns 'xs' for small mobile viewports", () => {
    setWidth(320);
    expect(getBreakpoint()).toBe("xs");
  });

  it("returns 'sm' for small viewport", () => {
    setWidth(640);
    expect(getBreakpoint()).toBe("sm");
  });

  it("returns 'md' for tablet viewport", () => {
    setWidth(768);
    expect(getBreakpoint()).toBe("md");
  });

  it("returns 'lg' for desktop viewport", () => {
    setWidth(1024);
    expect(getBreakpoint()).toBe("lg");
  });

  it("returns 'xl' for wide viewport", () => {
    setWidth(1280);
    expect(getBreakpoint()).toBe("xl");
  });

  it("returns '2xl' for very wide viewport", () => {
    setWidth(1400);
    expect(getBreakpoint()).toBe("2xl");
  });
});

describe("isAtLeast()", () => {
  const setWidth = (w: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  };

  it("returns true when width >= breakpoint", () => {
    setWidth(1024);
    expect(isAtLeast("lg")).toBe(true);
    expect(isAtLeast("md")).toBe(true);
  });

  it("returns false when width < breakpoint", () => {
    setWidth(600);
    expect(isAtLeast("md")).toBe(false);
    expect(isAtLeast("lg")).toBe(false);
  });
});

describe("isBelow()", () => {
  it("returns true when width < breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
    expect(isBelow("md")).toBe(true);
  });

  it("returns false when width >= breakpoint", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    expect(isBelow("md")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// responsive()
// ─────────────────────────────────────────────────────────────────────────────

describe("responsive()", () => {
  const setWidth = (w: number) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  };

  it("returns base value when no breakpoint-specific value matches", () => {
    setWidth(320);
    expect(responsive({ base: "1rem" })).toBe("1rem");
  });

  it("returns the md value on a tablet-width viewport", () => {
    setWidth(900);
    expect(responsive({ base: "1rem", md: "2rem" })).toBe("2rem");
  });

  it("returns the lg value on a desktop-width viewport", () => {
    setWidth(1100);
    expect(responsive({ base: "1rem", md: "2rem", lg: "3rem" })).toBe("3rem");
  });

  it("falls back to a smaller breakpoint when the exact one is not defined", () => {
    setWidth(900); // md
    // no md defined — should fall back to base
    expect(responsive({ base: "1rem", lg: "3rem" })).toBe("1rem");
  });

  it("returns empty string when called with empty object", () => {
    expect(responsive({})).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyAccentColor()
// ─────────────────────────────────────────────────────────────────────────────

describe("applyAccentColor()", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-accent");
  });

  it("sets data-accent for non-blue colours", () => {
    applyAccentColor("purple");
    expect(document.documentElement.getAttribute("data-accent")).toBe("purple");
  });

  it("removes data-accent for blue (the default)", () => {
    document.documentElement.setAttribute("data-accent", "pink");
    applyAccentColor("blue");
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
  });

  it("tracks an accent_changed event", () => {
    clearStyleEvents();
    applyAccentColor("green");
    const events = getStyleEvents();
    expect(events[0]?.type).toBe("accent_changed");
    expect(events[0]?.detail).toBe("green");
  });
});

describe("getAccentColor()", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-accent");
  });

  it("returns 'blue' when no data-accent attribute is set", () => {
    expect(getAccentColor()).toBe("blue");
  });

  it("returns the current data-accent value", () => {
    document.documentElement.setAttribute("data-accent", "orange");
    expect(getAccentColor()).toBe("orange");
  });
});

describe("ACCENT_HSL", () => {
  it("defines HSL strings for all 6 accent colours", () => {
    const colors = ["blue", "purple", "green", "orange", "red", "pink"] as const;
    colors.forEach((c) => {
      expect(typeof ACCENT_HSL[c]).toBe("string");
      expect(ACCENT_HSL[c].length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyCompactMode()
// ─────────────────────────────────────────────────────────────────────────────

describe("applyCompactMode()", () => {
  afterEach(() => {
    document.documentElement.classList.remove("compact");
  });

  it("adds 'compact' class when enabled", () => {
    applyCompactMode(true);
    expect(document.documentElement.classList.contains("compact")).toBe(true);
  });

  it("removes 'compact' class when disabled", () => {
    document.documentElement.classList.add("compact");
    applyCompactMode(false);
    expect(document.documentElement.classList.contains("compact")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyAnimationsEnabled()
// ─────────────────────────────────────────────────────────────────────────────

describe("applyAnimationsEnabled()", () => {
  afterEach(() => {
    document.documentElement.classList.remove("reduce-motion");
  });

  it("adds 'reduce-motion' when animations are disabled", () => {
    applyAnimationsEnabled(false);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(true);
  });

  it("removes 'reduce-motion' when animations are enabled", () => {
    document.documentElement.classList.add("reduce-motion");
    applyAnimationsEnabled(true);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Style analytics
// ─────────────────────────────────────────────────────────────────────────────

describe("Style analytics", () => {
  beforeEach(() => clearStyleEvents());

  it("trackStyleEvent records an event", () => {
    trackStyleEvent("theme_changed", "dark");
    const events = getStyleEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("theme_changed");
    expect(events[0]?.detail).toBe("dark");
  });

  it("records multiple events in most-recent-first order", () => {
    trackStyleEvent("theme_changed", "light");
    trackStyleEvent("accent_changed", "purple");
    const events = getStyleEvents();
    expect(events[0]?.type).toBe("accent_changed");
    expect(events[1]?.type).toBe("theme_changed");
  });

  it("getStyleSummary counts per type correctly", () => {
    trackStyleEvent("theme_changed", "dark");
    trackStyleEvent("theme_changed", "light");
    trackStyleEvent("accent_changed", "green");
    const summary = getStyleSummary();
    expect(summary.theme_changed).toBe(2);
    expect(summary.accent_changed).toBe(1);
  });

  it("clearStyleEvents empties the list", () => {
    trackStyleEvent("compact_mode", "true");
    clearStyleEvents();
    expect(getStyleEvents()).toHaveLength(0);
  });

  it("events have a valid timestamp", () => {
    const before = Date.now();
    trackStyleEvent("animations_toggled", "false");
    const after = Date.now();
    const ev = getStyleEvents()[0]!;
    expect(ev.timestamp).toBeGreaterThanOrEqual(before);
    expect(ev.timestamp).toBeLessThanOrEqual(after);
  });
});
