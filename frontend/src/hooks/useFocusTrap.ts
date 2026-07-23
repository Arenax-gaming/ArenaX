"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  getFocusableElements,
  focusFirstElement,
  restoreFocus,
  handleFocusTrap,
} from "@/lib/accessibility";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseFocusTrapOptions {
  /** When true, focus is trapped within the container. */
  enabled: boolean;
  /** Whether to auto-focus the first element when the trap activates (default: true). */
  autoFocus?: boolean;
  /** Whether to restore focus to the previously focused element on deactivation (default: true). */
  restoreOnDeactivate?: boolean;
  /** Called when Escape is pressed inside the trap. */
  onEscape?: () => void;
}

export interface UseFocusTrapReturn {
  /** Attach this ref to the container element you want to trap focus in. */
  containerRef: React.RefObject<HTMLElement>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useFocusTrap` manages focus for dialogs, drawers, and overlays.
 *
 * - Traps Tab / Shift+Tab within the container
 * - Optionally focuses the first focusable element on activation
 * - Restores focus to the previously active element on deactivation
 * - Fires `onEscape` when Escape is pressed
 *
 * @example
 * ```tsx
 * const { containerRef } = useFocusTrap({ enabled: isOpen, onEscape: close });
 *
 * <div ref={containerRef} role="dialog" aria-modal="true">
 *   ...
 * </div>
 * ```
 */
export function useFocusTrap({
  enabled,
  autoFocus = true,
  restoreOnDeactivate = true,
  onEscape,
}: UseFocusTrapOptions): UseFocusTrapReturn {
  const containerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save the previously focused element when the trap activates
  useEffect(() => {
    if (enabled) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    }
  }, [enabled]);

  // Auto-focus first element when enabled
  useEffect(() => {
    if (!enabled || !autoFocus || !containerRef.current) return;

    // Small RAF delay lets the element finish mounting / animating in
    const frame = requestAnimationFrame(() => {
      if (containerRef.current) {
        focusFirstElement(containerRef.current);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [enabled, autoFocus]);

  // Restore focus on deactivation
  useEffect(() => {
    if (!enabled && restoreOnDeactivate) {
      restoreFocus(previousFocusRef.current);
    }
  }, [enabled, restoreOnDeactivate]);

  // Tab trap + Escape handler
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || !containerRef.current) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onEscape?.();
        return;
      }

      handleFocusTrap(event, containerRef.current);
    },
    [enabled, onEscape],
  );

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, handleKeyDown]);

  return { containerRef: containerRef as React.RefObject<HTMLElement> };
}

// ─── Companion: focus sentinel ────────────────────────────────────────────────

/**
 * Returns a ref that, when attached to a container, reports how many focusable
 * elements it currently contains.  Useful for disabling trapping when there is
 * nothing to trap within.
 */
export function useFocusableCount(): {
  containerRef: React.RefObject<HTMLElement>;
  count: number;
} {
  const containerRef = useRef<HTMLElement>(null);
  const [count, setCount] = useRefState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => setCount(getFocusableElements(el).length);
    update();

    const observer = new MutationObserver(update);
    observer.observe(el, { childList: true, subtree: true, attributes: true });
    return () => observer.disconnect();
  }, [setCount]);

  return { containerRef: containerRef as React.RefObject<HTMLElement>, count };
}

/** Minimal useState-backed ref that avoids an extra re-render cycle. */
function useRefState<T>(initial: T): [T, (v: T) => void] {
  const [state, setState] = [useRef(initial), useRef<(v: T) => void>(() => {})];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const set = useCallback((v: T) => {
    state.current = v;
    setState.current(v);
  }, []);
  return [state.current, set];
}
