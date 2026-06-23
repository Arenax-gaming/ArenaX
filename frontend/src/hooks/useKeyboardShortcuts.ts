"use client";

/**
 * useKeyboardShortcuts — Issue #519
 *
 * Provides a global, context-aware keyboard shortcut system:
 *   - Global shortcuts active on every page (Escape, /, g+h, etc.)
 *   - Context shortcuts registered/unregistered per route or component
 *   - User-customisable bindings persisted to localStorage
 *   - Conflict detection (two actions bound to the same key)
 *   - Built-in shortcut help modal toggle (? key)
 *   - Analytics: tracks which shortcuts are used
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShortcutCategory = "navigation" | "game" | "tournament" | "profile" | "global";

export interface Shortcut {
  id: string;
  description: string;
  category: ShortcutCategory;
  /** Primary key combo, e.g. "g+h", "ctrl+k", "/" */
  key: string;
  /** Optional alternative key combo */
  altKey?: string;
  /** If true, fires even when focus is in an input/textarea */
  allowInInput?: boolean;
}

export interface ShortcutAnalyticsEntry {
  id: string;
  count: number;
  lastUsed: number;
}

export interface UseKeyboardShortcutsReturn {
  shortcuts: Shortcut[];
  customBindings: Record<string, string>;
  isHelpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  registerShortcuts: (shortcuts: Shortcut[]) => () => void;
  customise: (shortcutId: string, newKey: string) => boolean;
  resetCustomisation: (shortcutId?: string) => void;
  getAnalytics: () => ShortcutAnalyticsEntry[];
}

// ---------------------------------------------------------------------------
// Default global shortcuts
// ---------------------------------------------------------------------------

const GLOBAL_SHORTCUTS: Shortcut[] = [
  { id: "help", description: "Toggle keyboard shortcuts help", category: "global", key: "?", allowInInput: false },
  { id: "search", description: "Open search", category: "global", key: "/", allowInInput: false },
  { id: "escape", description: "Close modal / cancel", category: "global", key: "Escape", allowInInput: true },
  { id: "nav_home", description: "Go to Home", category: "navigation", key: "g+h" },
  { id: "nav_tournaments", description: "Go to Tournaments", category: "navigation", key: "g+t" },
  { id: "nav_leaderboard", description: "Go to Leaderboard", category: "navigation", key: "g+l" },
  { id: "nav_profile", description: "Go to Profile", category: "navigation", key: "g+p" },
  { id: "nav_matches", description: "Go to Matches", category: "navigation", key: "g+m" },
  { id: "new_match", description: "Create a new match", category: "game", key: "n+m" },
  { id: "join_tournament", description: "Join a tournament", category: "tournament", key: "n+t" },
];

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const STORAGE_KEY = "arenax_shortcut_bindings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalise = (key: string): string => key.toLowerCase().trim();

/** Check whether the currently focused element should block shortcut firing. */
const isInputFocused = (): boolean => {
  const tag = (document.activeElement?.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
};

/** Parse a combo like "ctrl+k" or "g+h" into its parts. */
const parseCombo = (combo: string): string[] =>
  combo.split("+").map((p) => p.trim().toLowerCase());

/** Check if a KeyboardEvent matches a combo string. */
const matchesCombo = (event: KeyboardEvent, combo: string): boolean => {
  const parts = parseCombo(combo);
  if (parts.length === 1) {
    return normalise(event.key) === parts[0]!;
  }
  // Multi-key combos — modifiers + final key, or chord sequences handled via pendingChord
  const modifiers = parts.slice(0, -1);
  const finalKey = parts[parts.length - 1]!;
  const hasCtrl = modifiers.includes("ctrl") ? event.ctrlKey : !event.ctrlKey;
  const hasShift = modifiers.includes("shift") ? event.shiftKey : !event.shiftKey;
  const hasAlt = modifiers.includes("alt") ? event.altKey : !event.altKey;
  const hasMeta = modifiers.includes("meta") ? event.metaKey : !event.metaKey;
  return (
    hasCtrl && hasShift && hasAlt && hasMeta && normalise(event.key) === finalKey
  );
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useKeyboardShortcuts(
  onAction: (id: string) => void,
): UseKeyboardShortcutsReturn {
  const [contextShortcuts, setContextShortcuts] = useState<Shortcut[]>([]);
  const [customBindings, setCustomBindings] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const analyticsRef = useRef<Map<string, ShortcutAnalyticsEntry>>(new Map());
  // Chord state: first key of a two-key combo (e.g. "g" in "g+h")
  const pendingChordRef = useRef<string | null>(null);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allShortcuts = useMemo<Shortcut[]>(
    () => [...GLOBAL_SHORTCUTS, ...contextShortcuts],
    [contextShortcuts],
  );

  // Resolve effective key for a shortcut (custom binding overrides default)
  const effectiveKey = useCallback(
    (s: Shortcut): string => customBindings[s.id] ?? s.key,
    [customBindings],
  );

  const fire = useCallback(
    (id: string) => {
      const entry = analyticsRef.current.get(id) ?? { id, count: 0, lastUsed: 0 };
      analyticsRef.current.set(id, { ...entry, count: entry.count + 1, lastUsed: Date.now() });
      if (id === "help") {
        setIsHelpOpen((v) => !v);
      } else {
        onAction(id);
      }
    },
    [onAction],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Ignore if a modal / dialog is trapping focus (aria-modal)
      if (document.querySelector("[aria-modal='true'][open]")) return;

      const inInput = isInputFocused();
      const key = normalise(event.key);

      for (const shortcut of allShortcuts) {
        if (inInput && !shortcut.allowInInput) continue;

        const binding = effectiveKey(shortcut);
        const parts = parseCombo(binding);

        if (parts.length === 2 && !parts[0]!.includes("ctrl") && !parts[0]!.includes("alt")) {
          // Chord: e.g. "g+h"
          if (pendingChordRef.current === parts[0] && key === parts[1]) {
            if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
            pendingChordRef.current = null;
            event.preventDefault();
            fire(shortcut.id);
            return;
          }
        } else if (matchesCombo(event, binding)) {
          event.preventDefault();
          fire(shortcut.id);
          return;
        }
      }

      // Set first chord key if it starts any binding
      const startsChord = allShortcuts.some((s) => {
        const parts = parseCombo(effectiveKey(s));
        return parts.length === 2 && parts[0] === key;
      });
      if (startsChord && !inInput) {
        pendingChordRef.current = key;
        if (chordTimerRef.current) clearTimeout(chordTimerRef.current);
        chordTimerRef.current = setTimeout(() => {
          pendingChordRef.current = null;
        }, 1000);
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [allShortcuts, effectiveKey, fire]);

  const registerShortcuts = useCallback((newShortcuts: Shortcut[]): (() => void) => {
    setContextShortcuts((prev) => [...prev, ...newShortcuts]);
    return () => {
      const ids = new Set(newShortcuts.map((s) => s.id));
      setContextShortcuts((prev) => prev.filter((s) => !ids.has(s.id)));
    };
  }, []);

  const customise = useCallback((shortcutId: string, newKey: string): boolean => {
    const normalised = normalise(newKey);
    // Conflict check
    const conflict = allShortcuts.find(
      (s) => s.id !== shortcutId && effectiveKey(s) === normalised,
    );
    if (conflict) return false;

    setCustomBindings((prev) => {
      const updated = { ...prev, [shortcutId]: normalised };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    return true;
  }, [allShortcuts, effectiveKey]);

  const resetCustomisation = useCallback((shortcutId?: string) => {
    setCustomBindings((prev) => {
      const updated = shortcutId ? { ...prev } : {};
      if (shortcutId) delete updated[shortcutId];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  return {
    shortcuts: allShortcuts,
    customBindings,
    isHelpOpen,
    openHelp: () => setIsHelpOpen(true),
    closeHelp: () => setIsHelpOpen(false),
    toggleHelp: () => setIsHelpOpen((v) => !v),
    registerShortcuts,
    customise,
    resetCustomisation,
    getAnalytics: () => Array.from(analyticsRef.current.values()),
  };
}
