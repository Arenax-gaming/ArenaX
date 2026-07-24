"use client";

import { useEffect, useCallback } from "react";
import { useTheme } from "next-themes";
import type { ThemeSettings, AccentColor, ThemeMode } from "@/types/settings";
import {
  applyAccentColor,
  applyCompactMode,
  applyAnimationsEnabled,
  getAccentColor,
  trackStyleEvent,
} from "@/lib/theme";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseThemeConfigReturn {
  /** Apply a complete ThemeSettings object — syncs next-themes + CSS vars. */
  applySettings: (settings: ThemeSettings) => void;
  /** Change only the mode (light | dark | system). */
  setMode: (mode: ThemeMode) => void;
  /** Change only the accent colour. */
  setAccentColor: (color: AccentColor) => void;
  /** Toggle compact mode. */
  setCompactMode: (enabled: boolean) => void;
  /** Toggle animations. */
  setAnimationsEnabled: (enabled: boolean) => void;
  /** The currently active accent colour (from the DOM attribute). */
  activeAccent: AccentColor;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useThemeConfig` bridges user `ThemeSettings` with:
 * - `next-themes` (mode: light / dark / system)
 * - CSS custom property overrides via `data-accent` on `<html>`
 * - `compact` and `reduce-motion` CSS class toggles
 * - Style analytics tracking
 *
 * @example
 * ```tsx
 * const { applySettings } = useThemeConfig();
 *
 * // In a settings save handler:
 * applySettings({ mode: "dark", accentColor: "purple", compactMode: false, animationsEnabled: true });
 * ```
 */
export function useThemeConfig(): UseThemeConfigReturn {
  const { setTheme, resolvedTheme } = useTheme();

  // Re-read the DOM attribute on mount so the hook stays in sync
  const activeAccent = getAccentColor();

  const setMode = useCallback(
    (mode: ThemeMode) => {
      setTheme(mode);
      trackStyleEvent("theme_changed", mode);
    },
    [setTheme],
  );

  const setAccentColor = useCallback((color: AccentColor) => {
    applyAccentColor(color);
  }, []);

  const setCompactMode = useCallback((enabled: boolean) => {
    applyCompactMode(enabled);
    trackStyleEvent("compact_mode", String(enabled));
  }, []);

  const setAnimationsEnabled = useCallback((enabled: boolean) => {
    applyAnimationsEnabled(enabled);
    trackStyleEvent("animations_toggled", String(enabled));
  }, []);

  const applySettings = useCallback(
    (settings: ThemeSettings) => {
      setMode(settings.mode);
      setAccentColor(settings.accentColor);
      setCompactMode(settings.compactMode);
      setAnimationsEnabled(settings.animationsEnabled);
    },
    [setMode, setAccentColor, setCompactMode, setAnimationsEnabled],
  );

  // On mount: restore accent colour from localStorage if previously saved
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("arenax_accent");
      if (stored) applyAccentColor(stored as AccentColor);
    } catch {/* ignore */}
  }, []);

  return {
    applySettings,
    setMode,
    setAccentColor,
    setCompactMode,
    setAnimationsEnabled,
    activeAccent,
  };
}
