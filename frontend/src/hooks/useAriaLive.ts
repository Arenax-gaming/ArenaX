"use client";

import { useCallback } from "react";
import { useAccessibility } from "@/components/providers/AccessibilityProvider";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PolitenessLevel = "polite" | "assertive";

export interface UseAriaLiveReturn {
  /** Announce a message politely (does not interrupt). */
  announcePolite: (message: string) => void;
  /** Announce a message assertively (interrupts current screen-reader speech). */
  announceAssertive: (message: string) => void;
  /** Announce a message at a specific politeness level. */
  announce: (message: string, level?: PolitenessLevel) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useAriaLive` gives components access to the global aria-live announcement
 * queue managed by `AccessibilityProvider`.
 *
 * Uses the global singleton `announcer` from `lib/accessibility`, so a single
 * pair of `aria-live` DOM nodes is shared across the whole application.
 *
 * @example
 * ```tsx
 * const { announcePolite } = useAriaLive();
 *
 * const handleSave = async () => {
 *   await save();
 *   announcePolite("Changes saved successfully.");
 * };
 * ```
 */
export function useAriaLive(): UseAriaLiveReturn {
  const { announce } = useAccessibility();

  const announcePolite = useCallback(
    (message: string) => announce(message, "polite"),
    [announce],
  );

  const announceAssertive = useCallback(
    (message: string) => announce(message, "assertive"),
    [announce],
  );

  const announceWithLevel = useCallback(
    (message: string, level: PolitenessLevel = "polite") => announce(message, level),
    [announce],
  );

  return {
    announcePolite,
    announceAssertive,
    announce: announceWithLevel,
  };
}
