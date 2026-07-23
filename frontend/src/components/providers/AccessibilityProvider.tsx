"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { a11yAnalytics, announce, A11yAnalyticsEntry, A11yEventType } from "@/lib/accessibility";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccessibilityPreferences {
  /** User has OS-level reduced-motion enabled. */
  prefersReducedMotion: boolean;
  /** User has OS-level high-contrast enabled. */
  prefersHighContrast: boolean;
  /** Whether screen-reader mode is manually enabled in settings. */
  screenReaderEnabled: boolean;
  /** Whether the keyboard is being used for navigation (shows focus rings). */
  isKeyboardUser: boolean;
}

export interface AccessibilityContextType {
  preferences: AccessibilityPreferences;
  /** Update one or more preferences (e.g. from AccessibilityOptions settings panel). */
  updatePreferences: (patch: Partial<AccessibilityPreferences>) => void;
  /** Send a message to the global aria-live region. */
  announce: (message: string, level?: "polite" | "assertive") => void;
  /** Track an accessibility event for analytics. */
  trackA11y: (type: A11yEventType, detail?: string) => void;
  /** All tracked events in the current session. */
  a11yEvents: A11yAnalyticsEntry[];
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AccessibilityContext = createContext<AccessibilityContextType | undefined>(undefined);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>({
    prefersReducedMotion: false,
    prefersHighContrast: false,
    screenReaderEnabled: false,
    isKeyboardUser: false,
  });

  const [a11yEvents, setA11yEvents] = useState<A11yAnalyticsEntry[]>([]);
  const keyboardRef = useRef(false);

  // ── Detect OS-level media queries ─────────────────────────────────────────

  useEffect(() => {
    if (typeof window === "undefined") return;

    const motionMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const contrastMq = window.matchMedia("(prefers-contrast: more)");

    const handleMotion = (e: MediaQueryListEvent | MediaQueryList) => {
      setPreferences((prev) => ({ ...prev, prefersReducedMotion: e.matches }));
      if (e.matches) {
        a11yAnalytics.track("reduced_motion_detected");
        setA11yEvents(a11yAnalytics.getEvents());
      }
    };

    const handleContrast = (e: MediaQueryListEvent | MediaQueryList) => {
      setPreferences((prev) => ({ ...prev, prefersHighContrast: e.matches }));
      if (e.matches) {
        a11yAnalytics.track("high_contrast_detected");
        setA11yEvents(a11yAnalytics.getEvents());
      }
    };

    // Read initial values
    handleMotion(motionMq);
    handleContrast(contrastMq);

    motionMq.addEventListener("change", handleMotion);
    contrastMq.addEventListener("change", handleContrast);

    return () => {
      motionMq.removeEventListener("change", handleMotion);
      contrastMq.removeEventListener("change", handleContrast);
    };
  }, []);

  // ── Detect keyboard vs pointer navigation ─────────────────────────────────
  // We add a `.keyboard-user` class on <body> and set `isKeyboardUser` so
  // components can conditionally render more prominent focus indicators.

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && !keyboardRef.current) {
        keyboardRef.current = true;
        document.body.classList.add("keyboard-user");
        setPreferences((prev) => ({ ...prev, isKeyboardUser: true }));
        a11yAnalytics.track("keyboard_nav", "Tab key detected");
        setA11yEvents(a11yAnalytics.getEvents());
      }
    };

    const handlePointerDown = () => {
      if (keyboardRef.current) {
        keyboardRef.current = false;
        document.body.classList.remove("keyboard-user");
        setPreferences((prev) => ({ ...prev, isKeyboardUser: false }));
      }
    };

    window.addEventListener("keydown", handleKeyDown, { passive: true });
    window.addEventListener("pointerdown", handlePointerDown, { passive: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  // ── Apply CSS classes to <html> for global a11y styles ────────────────────

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("reduce-motion", preferences.prefersReducedMotion);
    root.classList.toggle("high-contrast", preferences.prefersHighContrast);
    root.classList.toggle("screen-reader", preferences.screenReaderEnabled);
  }, [preferences.prefersReducedMotion, preferences.prefersHighContrast, preferences.screenReaderEnabled]);

  // ── Axe-core in development ───────────────────────────────────────────────

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      import("@axe-core/react")
        .then((axe) => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const ReactDOM = require("react-dom");
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const ReactLib = require("react");
          axe.default(ReactLib, ReactDOM, 1_000, undefined, (violations) => {
            if (violations.length > 0) {
              violations.forEach((v) => {
                a11yAnalytics.track("violation_detected", `${v.id}: ${v.description}`);
              });
              setA11yEvents(a11yAnalytics.getEvents());
            }
          });
        })
        .catch(() => {/* axe-core is optional */});
    }
  }, []);

  // ── Public API ────────────────────────────────────────────────────────────

  const updatePreferences = useCallback((patch: Partial<AccessibilityPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...patch }));
  }, []);

  const trackA11y = useCallback((type: A11yEventType, detail?: string) => {
    a11yAnalytics.track(type, detail);
    setA11yEvents(a11yAnalytics.getEvents());
  }, []);

  const announceMessage = useCallback(
    (message: string, level: "polite" | "assertive" = "polite") => {
      announce(message, level);
      trackA11y("screen_reader_announced", message.slice(0, 80));
    },
    [trackA11y],
  );

  return (
    <AccessibilityContext.Provider
      value={{
        preferences,
        updatePreferences,
        announce: announceMessage,
        trackA11y,
        a11yEvents,
      }}
    >
      {children}
    </AccessibilityContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAccessibility(): AccessibilityContextType {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) {
    throw new Error("useAccessibility must be used within an AccessibilityProvider");
  }
  return ctx;
}
