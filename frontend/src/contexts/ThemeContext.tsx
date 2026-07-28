/**
 * ThemeContext — Issue #692
 *
 * Full-featured theme context wrapping next-themes with:
 * - Light / dark / system modes
 * - Accent colour management (via globals.css data-accent attribute)
 * - Compact mode & animation toggle
 * - CSS-variable live updates
 * - localStorage persistence
 * - Analytics hooks for every theme transition
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTheme as useNextTheme } from "next-themes";
import {
  applyAccentColor,
  applyCompactMode,
  applyAnimationsEnabled,
  trackStyleEvent,
  type StyleAnalyticsEntry,
  getStyleEvents,
} from "@/lib/theme";
import type { AccentColor, ThemeMode } from "@/types/settings";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ThemePreferences {
  mode: ThemeMode;
  accent: AccentColor;
  compactMode: boolean;
  animationsEnabled: boolean;
}

interface ThemeContextValue {
  /** Current resolved theme ("light" | "dark") */
  resolved: string | undefined;
  /** User-selected mode ("light" | "dark" | "system") */
  mode: ThemeMode;
  accent: AccentColor;
  compactMode: boolean;
  animationsEnabled: boolean;
  // Actions
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setAccent: (accent: AccentColor) => void;
  setCompactMode: (enabled: boolean) => void;
  setAnimationsEnabled: (enabled: boolean) => void;
  resetToDefaults: () => void;
  // Analytics
  getThemeEvents: () => StyleAnalyticsEntry[];
}

// ─── Persistence key ──────────────────────────────────────────────────────────

const STORAGE_KEY = "arenax_theme_preferences";

const DEFAULT_PREFS: ThemePreferences = {
  mode: "system",
  accent: "blue",
  compactMode: false,
  animationsEnabled: true,
};

function loadStoredPrefs(): Partial<ThemePreferences> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<ThemePreferences>;
  } catch {
    return {};
  }
}

function savePrefs(prefs: ThemePreferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch { /* quota */ }
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | null>(null);
ThemeContext.displayName = "ThemeContext";

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ThemeContextProvider({ children }: { children: ReactNode }) {
  const { theme, setTheme, resolvedTheme } = useNextTheme();

  // Hydrate preferences from storage on mount
  const [accent, setAccentState] = useState<AccentColor>(() => {
    const stored = loadStoredPrefs();
    return stored.accent ?? DEFAULT_PREFS.accent;
  });
  const [compactMode, setCompactState] = useState<boolean>(() => {
    const stored = loadStoredPrefs();
    return stored.compactMode ?? DEFAULT_PREFS.compactMode;
  });
  const [animationsEnabled, setAnimState] = useState<boolean>(() => {
    const stored = loadStoredPrefs();
    return stored.animationsEnabled ?? DEFAULT_PREFS.animationsEnabled;
  });

  // Apply CSS effects whenever individual prefs change
  useEffect(() => {
    applyAccentColor(accent);
  }, [accent]);

  useEffect(() => {
    applyCompactMode(compactMode);
  }, [compactMode]);

  useEffect(() => {
    applyAnimationsEnabled(animationsEnabled);
  }, [animationsEnabled]);

  // Persist all prefs to localStorage whenever any changes
  const mode = (theme ?? "system") as ThemeMode;
  useEffect(() => {
    const prefs: ThemePreferences = { mode, accent, compactMode, animationsEnabled };
    savePrefs(prefs);
  }, [mode, accent, compactMode, animationsEnabled]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const setMode = useCallback((m: ThemeMode) => {
    setTheme(m);
    trackStyleEvent("theme_changed", m);
  }, [setTheme]);

  const toggleMode = useCallback(() => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(next);
    trackStyleEvent("theme_changed", next);
  }, [resolvedTheme, setTheme]);

  const setAccent = useCallback((a: AccentColor) => {
    setAccentState(a);
    // applyAccentColor is called in the effect above
    trackStyleEvent("accent_changed", a);
  }, []);

  const setCompactMode = useCallback((enabled: boolean) => {
    setCompactState(enabled);
    trackStyleEvent("compact_mode", String(enabled));
  }, []);

  const setAnimationsEnabled = useCallback((enabled: boolean) => {
    setAnimState(enabled);
    trackStyleEvent("animations_toggled", String(enabled));
  }, []);

  const resetToDefaults = useCallback(() => {
    setTheme(DEFAULT_PREFS.mode);
    setAccentState(DEFAULT_PREFS.accent);
    setCompactState(DEFAULT_PREFS.compactMode);
    setAnimState(DEFAULT_PREFS.animationsEnabled);
    trackStyleEvent("theme_changed", "reset");
  }, [setTheme]);

  const getThemeEvents = useCallback(() => getStyleEvents(), []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      resolved: resolvedTheme,
      mode,
      accent,
      compactMode,
      animationsEnabled,
      setMode,
      toggleMode,
      setAccent,
      setCompactMode,
      setAnimationsEnabled,
      resetToDefaults,
      getThemeEvents,
    }),
    [
      resolvedTheme,
      mode,
      accent,
      compactMode,
      animationsEnabled,
      setMode,
      toggleMode,
      setAccent,
      setCompactMode,
      setAnimationsEnabled,
      resetToDefaults,
      getThemeEvents,
    ],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeContext must be used inside <ThemeContextProvider>");
  return ctx;
}

/** Convenience alias — preferred public API */
export const useTheme = useThemeContext;
