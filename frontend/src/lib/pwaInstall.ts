"use client";

/**
 * PWA install-prompt state and measurement (Issue #858).
 *
 * Three things the browser's own prompt cannot do, which the target of a 20%+
 * install rate needs:
 *
 *   1. **Remember a dismissal.** Chrome re-offers `beforeinstallprompt` on
 *      every visit. A banner a user has already said no to, shown again
 *      tomorrow, is the fastest way to train them to ignore it.
 *   2. **Attribute an install.** `appinstalled` says an install happened, not
 *      which prompt copy produced it, so nothing can be compared.
 *   3. **Split traffic.** Improving an install rate means changing the offer
 *      and measuring, which needs a stable cohort per visitor.
 *
 * State is local to the device on purpose: the prompt is a property of this
 * browser (a user who installed on their phone should still be asked on their
 * laptop), so syncing it to an account would suppress prompts that should
 * still appear.
 */

import type { AnalyticsEventName } from "@/types/analytics";
import { getAnalyticsService } from "@/lib/analytics";

const DISMISSAL_KEY = "arenax:pwa:dismissed-until";
const COHORT_KEY = "arenax:pwa:cohort";
const SHOWN_KEY = "arenax:pwa:last-shown";

/** How long a dismissal suppresses the prompt. */
export const DISMISSAL_DAYS = 30;
const DISMISSAL_MS = DISMISSAL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Copy cohorts.
 *
 * `benefits` leads with what the user gets; `speed` leads with performance.
 * Both are branded — the variable is the argument, not the styling, so a
 * difference in install rate is attributable to the message.
 */
export type PwaCohort = "benefits" | "speed";

const COHORTS: readonly PwaCohort[] = ["benefits", "speed"];

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode, or storage disabled. The prompt still works; it just
    // cannot remember anything, which is better than not rendering at all.
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do — see safeGet.
  }
}

/**
 * The visitor's cohort, assigned once and reused.
 *
 * Assigned on first sight rather than derived from a user id, because the
 * prompt is shown to signed-out visitors too and a cohort that changes when
 * someone logs in makes the measurement meaningless.
 */
export function getPwaCohort(): PwaCohort {
  const stored = safeGet(COHORT_KEY);
  if (stored && (COHORTS as readonly string[]).includes(stored)) {
    return stored as PwaCohort;
  }

  const assigned = COHORTS[Math.floor(Math.random() * COHORTS.length)] as PwaCohort;
  safeSet(COHORT_KEY, assigned);
  return assigned;
}

/** Whether a previous dismissal is still suppressing the prompt. */
export function isPromptSuppressed(now: number = Date.now()): boolean {
  const raw = safeGet(DISMISSAL_KEY);
  if (!raw) return false;

  const until = Number(raw);
  // A corrupt value must not suppress the prompt forever.
  if (!Number.isFinite(until)) return false;

  return now < until;
}

/** Suppress the prompt for the next `DISMISSAL_DAYS`. */
export function suppressPromptAfterDismissal(now: number = Date.now()): number {
  const until = now + DISMISSAL_MS;
  safeSet(DISMISSAL_KEY, String(until));
  return until;
}

/** Clear the suppression — used by tests and by a manual "install" action. */
export function clearPromptSuppression(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DISMISSAL_KEY);
  } catch {
    // ignore
  }
}

export function recordPromptShown(now: number = Date.now()): void {
  safeSet(SHOWN_KEY, String(now));
}

export function getLastPromptShown(): number | null {
  const raw = safeGet(SHOWN_KEY);
  const value = Number(raw);
  return raw && Number.isFinite(value) ? value : null;
}

/**
 * Emit a funnel event tagged with the cohort.
 *
 * Every event carries the cohort so shown → accepted can be computed per
 * variant; an install rate without a denominator per cohort cannot be compared
 * against the 20% goal.
 */
export function trackPwaEvent(
  event: Extract<AnalyticsEventName, `pwa_${string}`>,
  props?: Record<string, unknown>
): void {
  try {
    getAnalyticsService().track(event, {
      cohort: getPwaCohort(),
      ...(props ?? {}),
    });
  } catch {
    // Analytics must never break the prompt.
  }
}
