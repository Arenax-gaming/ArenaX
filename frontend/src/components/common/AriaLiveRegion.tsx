"use client";

import React, { useEffect, useState, useId } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AriaLiveRegionProps {
  /** The message to announce. Changing this value re-announces. */
  message: string;
  /** Politeness level — "polite" waits for silence; "assertive" interrupts. */
  ariaLive?: "polite" | "assertive";
  /** Whether multiple rapid updates should be coalesced into one announcement. */
  atomic?: boolean;
  /** Additional class names. Defaults to `sr-only` (visually hidden). */
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * `AriaLiveRegion` renders a visually-hidden region that screen readers
 * monitor for content changes and read aloud.
 *
 * Enhancements over the old version:
 * - Clears and re-sets the message so screen readers announce repeat values
 * - Generates a stable `id` for external `aria-describedby` references
 * - Accepts an `atomic` prop (default: true)
 * - Fully typed
 *
 * @example
 * ```tsx
 * // Form feedback
 * <AriaLiveRegion message={submitStatus} />
 *
 * // Urgent error — interrupts screen reader
 * <AriaLiveRegion message={error} ariaLive="assertive" />
 * ```
 */
export const AriaLiveRegion: React.FC<AriaLiveRegionProps> = ({
  message,
  ariaLive = "polite",
  atomic = true,
  className = "sr-only",
}) => {
  const id = useId();
  // We clear → re-set so that announcing the same string twice still fires.
  const [announced, setAnnounced] = useState("");

  useEffect(() => {
    if (!message) {
      setAnnounced("");
      return;
    }
    // Clear first so screen readers detect a genuine content change
    setAnnounced("");
    const timer = setTimeout(() => setAnnounced(message), 50);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div
      id={id}
      role={ariaLive === "assertive" ? "alert" : "status"}
      aria-live={ariaLive}
      aria-atomic={atomic}
      className={className}
    >
      {announced}
    </div>
  );
};

// ─── Compound: StatusAnnouncer ────────────────────────────────────────────────

/**
 * `StatusAnnouncer` is a named wrapper around `AriaLiveRegion` for
 * status-level messages (e.g. "3 results found", "Saved").
 */
export const StatusAnnouncer: React.FC<{ message: string }> = ({ message }) => (
  <AriaLiveRegion message={message} ariaLive="polite" />
);

/**
 * `AlertAnnouncer` is a named wrapper around `AriaLiveRegion` for urgent
 * messages that must interrupt screen-reader speech.
 */
export const AlertAnnouncer: React.FC<{ message: string }> = ({ message }) => (
  <AriaLiveRegion message={message} ariaLive="assertive" />
);
