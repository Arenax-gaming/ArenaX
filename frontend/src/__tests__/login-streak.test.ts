/**
 * Streak date arithmetic (Issue #899).
 *
 * The counter is the whole feature, and every bug in it is a date bug: a
 * player who kept their streak being told they lost it is the failure that
 * matters, so the boundaries are pinned explicitly.
 */

import {
  computeLongestStreak,
  computeStreak,
  endOfDay,
  toDayKey,
} from "@/hooks/useLoginStreak";

/** Local-time date, so the assertions do not depend on the runner's zone. */
function day(year: number, month: number, date: number): Date {
  return new Date(year, month - 1, date, 12, 0, 0);
}

describe("toDayKey", () => {
  it("formats a local date, zero-padded", () => {
    expect(toDayKey(day(2026, 1, 5))).toBe("2026-01-05");
    expect(toDayKey(day(2026, 12, 31))).toBe("2026-12-31");
  });

  it("uses the local calendar day, not UTC", () => {
    // 23:30 local on the 5th is the 6th in UTC for western zones; the streak
    // belongs to the day the player experienced.
    const late = new Date(2026, 0, 5, 23, 30, 0);
    expect(toDayKey(late)).toBe("2026-01-05");
  });
});

describe("computeStreak", () => {
  const today = day(2026, 3, 10);

  it("is zero with no history", () => {
    expect(computeStreak(new Set(), today)).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const days = new Set(["2026-03-08", "2026-03-09", "2026-03-10"]);
    expect(computeStreak(days, today)).toBe(3);
  });

  it("keeps the streak alive until midnight when today is not recorded yet", () => {
    // The player was here yesterday and has not opened the app today. At
    // 00:01 that is still an intact streak, not a broken one.
    const days = new Set(["2026-03-08", "2026-03-09"]);
    expect(computeStreak(days, today)).toBe(2);
  });

  it("breaks on a missed day", () => {
    const days = new Set(["2026-03-06", "2026-03-07", "2026-03-09", "2026-03-10"]);
    expect(computeStreak(days, today)).toBe(2);
  });

  it("is zero once two days have been missed", () => {
    const days = new Set(["2026-03-01", "2026-03-02"]);
    expect(computeStreak(days, today)).toBe(0);
  });

  it("counts across a month boundary", () => {
    const firstOfMarch = day(2026, 3, 1);
    const days = new Set(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(computeStreak(days, firstOfMarch)).toBe(3);
  });

  it("counts across a leap day", () => {
    const firstOfMarch2028 = day(2028, 3, 1);
    const days = new Set(["2028-02-28", "2028-02-29", "2028-03-01"]);
    expect(computeStreak(days, firstOfMarch2028)).toBe(3);
  });
});

describe("computeLongestStreak", () => {
  it("is zero with no history", () => {
    expect(computeLongestStreak(new Set())).toBe(0);
  });

  it("finds the longest run anywhere in history", () => {
    const days = new Set([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04", // run of 4
      "2026-02-01",
      "2026-02-02", // run of 2
    ]);
    expect(computeLongestStreak(days)).toBe(4);
  });

  it("treats a single day as a run of one", () => {
    expect(computeLongestStreak(new Set(["2026-01-01"]))).toBe(1);
  });
});

describe("endOfDay", () => {
  it("is local midnight at the end of the given day", () => {
    const end = endOfDay(day(2026, 3, 10));
    expect(end.getDate()).toBe(11);
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);
  });
});
