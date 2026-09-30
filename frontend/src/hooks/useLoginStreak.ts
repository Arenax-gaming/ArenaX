"use client";

/**
 * Daily login streak (Issue #899).
 *
 * # Where the data lives
 *
 * Visit days are recorded in `localStorage`, keyed per user. There is no
 * login-streak endpoint yet — `current_streak` on the profile is a *win*
 * streak, which is a different thing — so this keeps the feature shippable
 * while leaving one seam to move server-side: everything below reads and
 * writes through `loadHistory` / `saveHistory`, so replacing them with API
 * calls changes nothing else.
 *
 * The consequence, stated plainly because it affects whether rewards can carry
 * real value: a client-owned streak can be edited by the user. Treat the
 * rewards here as cosmetic until the record moves to the server.
 *
 * # Why days, not timestamps
 *
 * A streak is a question about calendar days in the player's own timezone
 * ("did I show up yesterday?"), not about elapsed hours. Storing `YYYY-MM-DD`
 * in local time makes "yesterday" exact and avoids a player in UTC+13 losing a
 * streak to a UTC date boundary.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

/** Days retained for the heat map. */
export const HISTORY_DAYS = 91;

/** Streak lengths that pay out. */
export const MILESTONES = [3, 7, 30] as const;
export type Milestone = (typeof MILESTONES)[number];

export const MILESTONE_REWARDS: Record<Milestone, { coins: number; label: string }> = {
  3: { coins: 50, label: "Warm-up bonus" },
  7: { coins: 200, label: "Week streak" },
  30: { coins: 1500, label: "Monthly dedication" },
};

export interface StreakDay {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  visited: boolean;
}

export interface LoginStreakState {
  current: number;
  longest: number;
  /** Milestones reached by the current streak. */
  reached: Milestone[];
  /** Reached but not yet redeemed. */
  claimable: Milestone[];
  claimed: Milestone[];
  /** Last `HISTORY_DAYS` days, oldest first, for the heat map. */
  calendar: StreakDay[];
  /** Local midnight tonight — when today's visit stops counting. */
  expiresAt: Date;
  loading: boolean;
  claimReward: (milestone: Milestone) => void;
}

interface StoredStreak {
  /** Visited days, `YYYY-MM-DD`, unordered. */
  days: string[];
  /** Milestones already redeemed, by the streak length that earned them. */
  claimed: number[];
}

const EMPTY: StoredStreak = { days: [], claimed: [] };

function storageKey(userId: string): string {
  return `arenax:streak:${userId}`;
}

/** Local calendar date for a Date, as `YYYY-MM-DD`. */
export function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Local midnight at the end of `date` — the deadline to keep a streak alive. */
export function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(24, 0, 0, 0);
  return end;
}

function loadHistory(userId: string): StoredStreak {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return EMPTY;

    const parsed = JSON.parse(raw) as Partial<StoredStreak>;
    return {
      days: Array.isArray(parsed.days) ? parsed.days.filter((d) => typeof d === "string") : [],
      claimed: Array.isArray(parsed.claimed)
        ? parsed.claimed.filter((c) => typeof c === "number")
        : [],
    };
  } catch {
    // Corrupt or unavailable storage resets the streak rather than crashing
    // the dashboard it renders on.
    return EMPTY;
  }
}

function saveHistory(userId: string, history: StoredStreak): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(history));
  } catch {
    // Quota or a blocking setting — the streak is a nicety, not a blocker.
  }
}

/**
 * Consecutive days ending today (or yesterday).
 *
 * Yesterday still counts: a player who has not opened the app *yet today* has
 * an intact streak until midnight, and showing it as broken at 00:01 would be
 * both wrong and demoralising.
 */
export function computeStreak(days: Set<string>, today: Date): number {
  if (days.size === 0) return 0;

  const start = days.has(toDayKey(today))
    ? today
    : days.has(toDayKey(addDays(today, -1)))
      ? addDays(today, -1)
      : null;

  if (!start) return 0;

  let streak = 0;
  let cursor = start;
  while (days.has(toDayKey(cursor))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

/** Longest run anywhere in the retained history. */
export function computeLongestStreak(days: Set<string>): number {
  const sorted = [...days].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;

  for (const day of sorted) {
    if (previous && toDayKey(addDays(new Date(`${previous}T00:00:00`), 1)) === day) {
      run += 1;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
    previous = day;
  }

  return longest;
}

export function useLoginStreak(): LoginStreakState {
  const { user } = useAuth();
  const [history, setHistory] = useState<StoredStreak>(EMPTY);
  const [loading, setLoading] = useState(true);
  const userId = user?.id ?? null;

  // Recording today's visit is the whole mechanism: rendering the dashboard is
  // the "login". Runs once per user per mount; writing the same day twice is
  // a no-op because days are a set.
  useEffect(() => {
    if (!userId) {
      setHistory(EMPTY);
      setLoading(false);
      return;
    }

    const stored = loadHistory(userId);
    const today = toDayKey(new Date());
    const cutoff = toDayKey(addDays(new Date(), -HISTORY_DAYS));

    const days = new Set(stored.days.filter((d) => d >= cutoff));
    const alreadyRecorded = days.has(today);
    days.add(today);

    const next: StoredStreak = { days: [...days].sort(), claimed: stored.claimed };
    setHistory(next);
    setLoading(false);

    // Only write when something changed, so a dashboard re-render does not
    // touch storage on every visit.
    if (!alreadyRecorded || next.days.length !== stored.days.length) {
      saveHistory(userId, next);
    }
  }, [userId]);

  const daySet = useMemo(() => new Set(history.days), [history.days]);

  const current = useMemo(() => computeStreak(daySet, new Date()), [daySet]);
  const longest = useMemo(
    () => Math.max(computeLongestStreak(daySet), current),
    [daySet, current]
  );

  const reached = useMemo(
    () => MILESTONES.filter((m) => current >= m),
    [current]
  );

  const claimed = useMemo(
    () => MILESTONES.filter((m) => history.claimed.includes(m)),
    [history.claimed]
  );

  const claimable = useMemo(
    () => reached.filter((m) => !history.claimed.includes(m)),
    [reached, history.claimed]
  );

  const calendar = useMemo<StreakDay[]>(() => {
    const today = new Date();
    return Array.from({ length: HISTORY_DAYS }, (_, i) => {
      const date = addDays(today, -(HISTORY_DAYS - 1 - i));
      const key = toDayKey(date);
      return { date: key, visited: daySet.has(key) };
    });
  }, [daySet]);

  const claimReward = useCallback(
    (milestone: Milestone) => {
      if (!userId) return;

      setHistory((prev) => {
        // Guarded against a double-click and against claiming a milestone the
        // streak has not actually reached.
        if (prev.claimed.includes(milestone)) return prev;
        if (computeStreak(new Set(prev.days), new Date()) < milestone) return prev;

        const next: StoredStreak = {
          ...prev,
          claimed: [...prev.claimed, milestone].sort((a, b) => a - b),
        };
        saveHistory(userId, next);
        return next;
      });
    },
    [userId]
  );

  return {
    current,
    longest,
    reached,
    claimable,
    claimed,
    calendar,
    expiresAt: endOfDay(new Date()),
    loading,
    claimReward,
  };
}
