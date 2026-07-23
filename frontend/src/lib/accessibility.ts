/**
 * Accessibility utility library for ArenaX.
 *
 * Provides:
 * - ID generators for ARIA relationships
 * - Focus management helpers
 * - ARIA attribute builders
 * - Keyboard event utilities
 * - Screen-reader announcement queue
 * - Accessibility analytics
 */

// ─── ID utilities ─────────────────────────────────────────────────────────────

let _idCounter = 0;

/**
 * Generates a stable, unique ARIA ID for a given prefix.
 * Use this to wire aria-labelledby / aria-describedby relationships.
 *
 * @example
 * const titleId = generateAriaId("modal-title");  // "arenax-modal-title-1"
 */
export function generateAriaId(prefix: string): string {
  return `arenax-${prefix}-${++_idCounter}`;
}

// ─── Focus management ─────────────────────────────────────────────────────────

const FOCUSABLE_SELECTOR =
  'a[href], area[href], input:not([disabled]):not([type="hidden"]), ' +
  "select:not([disabled]), textarea:not([disabled]), button:not([disabled]), " +
  'iframe, object, embed, [contenteditable], [tabindex]:not([tabindex="-1"])';

/**
 * Returns all focusable elements within a container, in DOM order.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && getComputedStyle(el).display !== "none",
  );
}

/**
 * Focuses the first focusable element inside `container`.
 * Falls back to focusing the container itself if nothing is found.
 */
export function focusFirstElement(container: HTMLElement): void {
  const first = getFocusableElements(container)[0];
  if (first) {
    first.focus();
  } else {
    container.focus();
  }
}

/**
 * Restores focus to `element` if it is still in the DOM.
 */
export function restoreFocus(element: HTMLElement | null): void {
  if (element && document.contains(element)) {
    element.focus();
  }
}

/**
 * Handles Tab / Shift+Tab key events to trap focus within `container`.
 * Call this inside a keydown handler on the container or document.
 */
export function handleFocusTrap(
  event: KeyboardEvent,
  container: HTMLElement,
): void {
  if (event.key !== "Tab") return;

  const focusable = getFocusableElements(container);
  if (focusable.length === 0) return;

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;

  if (event.shiftKey) {
    if (document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

// ─── Keyboard event helpers ───────────────────────────────────────────────────

/** Key codes used in the codebase — centralised so nothing is hard-coded. */
export const Keys = {
  Enter: "Enter",
  Space: " ",
  Escape: "Escape",
  Tab: "Tab",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
} as const;

/**
 * Returns true if the keyboard event is an "activation" (Enter or Space),
 * matching what browsers natively fire for click-like interactions.
 */
export function isActivationKey(event: React.KeyboardEvent | KeyboardEvent): boolean {
  return event.key === Keys.Enter || event.key === Keys.Space;
}

/**
 * Creates a synthetic `onClick`-compatible keyboard handler for elements that
 * must be interactive but are not native `<button>` / `<a>` elements.
 *
 * @example
 * <div
 *   role="button"
 *   tabIndex={0}
 *   onClick={handleClick}
 *   onKeyDown={createKeyboardActivationHandler(handleClick)}
 * />
 */
export function createKeyboardActivationHandler(
  onClick: (event: React.KeyboardEvent) => void,
): (event: React.KeyboardEvent) => void {
  return (event: React.KeyboardEvent) => {
    if (isActivationKey(event)) {
      event.preventDefault();
      onClick(event);
    }
  };
}

// ─── ARIA attribute builders ──────────────────────────────────────────────────

/**
 * Returns `aria-busy` attribute props for a loading state.
 */
export function ariaBusy(loading: boolean): { "aria-busy": boolean } {
  return { "aria-busy": loading };
}

/**
 * Returns `aria-disabled` attribute props.
 */
export function ariaDisabled(disabled: boolean): { "aria-disabled": boolean } {
  return { "aria-disabled": disabled };
}

/**
 * Returns the correct `aria-expanded` / `aria-controls` pair for
 * disclosure / accordion triggers.
 */
export function ariaExpanded(
  expanded: boolean,
  controlsId: string,
): { "aria-expanded": boolean; "aria-controls": string } {
  return { "aria-expanded": expanded, "aria-controls": controlsId };
}

/**
 * Returns `aria-selected` for tab / listbox item patterns.
 */
export function ariaSelected(selected: boolean): { "aria-selected": boolean } {
  return { "aria-selected": selected };
}

// ─── Screen-reader announcement queue ────────────────────────────────────────

type PolitenessLevel = "polite" | "assertive";

interface Announcement {
  message: string;
  level: PolitenessLevel;
  id: number;
}

let _announcementCounter = 0;

class AnnouncementQueue {
  private politeEl: HTMLElement | null = null;
  private assertiveEl: HTMLElement | null = null;
  private clearTimers = new Map<number, ReturnType<typeof setTimeout>>();

  private ensureElements(): void {
    if (typeof document === "undefined") return;

    if (!this.politeEl) {
      this.politeEl = document.getElementById("arenax-live-polite");
      if (!this.politeEl) {
        this.politeEl = document.createElement("div");
        this.politeEl.id = "arenax-live-polite";
        this.politeEl.setAttribute("aria-live", "polite");
        this.politeEl.setAttribute("aria-atomic", "true");
        this.politeEl.className = "sr-only";
        document.body.appendChild(this.politeEl);
      }
    }

    if (!this.assertiveEl) {
      this.assertiveEl = document.getElementById("arenax-live-assertive");
      if (!this.assertiveEl) {
        this.assertiveEl = document.createElement("div");
        this.assertiveEl.id = "arenax-live-assertive";
        this.assertiveEl.setAttribute("aria-live", "assertive");
        this.assertiveEl.setAttribute("aria-atomic", "true");
        this.assertiveEl.className = "sr-only";
        document.body.appendChild(this.assertiveEl);
      }
    }
  }

  announce(message: string, level: PolitenessLevel = "polite", clearAfterMs = 5_000): void {
    this.ensureElements();

    const el = level === "assertive" ? this.assertiveEl : this.politeEl;
    if (!el) return;

    const id = ++_announcementCounter;

    // Clear first so screen readers re-announce the same message if repeated
    el.textContent = "";
    requestAnimationFrame(() => {
      el.textContent = message;
    });

    if (clearAfterMs > 0) {
      const timer = setTimeout(() => {
        if (el.textContent === message) el.textContent = "";
        this.clearTimers.delete(id);
      }, clearAfterMs);
      this.clearTimers.set(id, timer);
    }
  }
}

export const announcer = new AnnouncementQueue();

/**
 * Convenience function — politely announces `message` to screen readers.
 */
export function announce(message: string, level: PolitenessLevel = "polite"): void {
  announcer.announce(message, level);
}

// ─── Accessibility analytics ──────────────────────────────────────────────────

export type A11yEventType =
  | "keyboard_nav"
  | "skip_link_used"
  | "focus_trap_activated"
  | "screen_reader_announced"
  | "shortcut_used"
  | "reduced_motion_detected"
  | "high_contrast_detected"
  | "violation_detected";

export interface A11yAnalyticsEntry {
  type: A11yEventType;
  detail?: string;
  timestamp: number;
}

class A11yAnalytics {
  private events: A11yAnalyticsEntry[] = [];
  private readonly maxEvents = 200;
  private readonly storageKey = "arenax_a11y_analytics";

  constructor() {
    this.load();
  }

  private load(): void {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (raw) this.events = JSON.parse(raw) as A11yAnalyticsEntry[];
    } catch {
      /* ignore */
    }
  }

  private save(): void {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(this.events));
    } catch {
      /* ignore */
    }
  }

  track(type: A11yEventType, detail?: string): void {
    const entry: A11yAnalyticsEntry = { type, detail, timestamp: Date.now() };
    this.events.unshift(entry);
    if (this.events.length > this.maxEvents) this.events.length = this.maxEvents;
    this.save();

    // Forward to global analytics if available
    const w = window as Window & { gtag?: (...args: unknown[]) => void };
    if (typeof w.gtag === "function") {
      w.gtag("event", "accessibility_action", {
        a11y_event_type: type,
        a11y_detail: detail ?? "",
      });
    }
  }

  getEvents(): A11yAnalyticsEntry[] {
    return [...this.events];
  }

  getSummary(): Record<A11yEventType, number> {
    const summary = {} as Record<A11yEventType, number>;
    for (const event of this.events) {
      summary[event.type] = (summary[event.type] ?? 0) + 1;
    }
    return summary;
  }

  clear(): void {
    this.events = [];
    this.save();
  }
}

export const a11yAnalytics = new A11yAnalytics();

// ─── Colour contrast helpers ───────────────────────────────────────────────────

/**
 * Computes relative luminance of an sRGB colour (0–255 per channel).
 * Formula: WCAG 2.1 §1.4.3
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Computes contrast ratio between two luminance values.
 * Returns a value between 1 (no contrast) and 21 (black on white).
 */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns whether the contrast ratio meets the specified WCAG level.
 * - AA normal text: 4.5:1
 * - AA large text / UI components: 3:1
 * - AAA normal text: 7:1
 */
export function meetsWcagContrast(
  ratio: number,
  level: "AA" | "AAA" | "AA-large",
): boolean {
  switch (level) {
    case "AA":
      return ratio >= 4.5;
    case "AAA":
      return ratio >= 7;
    case "AA-large":
      return ratio >= 3;
  }
}
