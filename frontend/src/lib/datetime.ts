/**
 * datetime.ts — date/time utility library
 *
 * Pure functions — no external dependencies, uses Intl APIs where available.
 * Extends the minimal utils.ts `formatDate` with a comprehensive toolkit.
 */

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a date for display with configurable precision.
 * @example
 * formatDateTime("2025-06-01T14:30:00Z", "medium") // "Jun 1, 2025, 2:30 PM"
 */
export function formatDateTime(
  date: string | Date | number,
  precision: "date" | "short" | "medium" | "long" = "medium",
  locale = "en-US"
): string {
  const d = toDate(date);

  const configs: Record<string, Intl.DateTimeFormatOptions> = {
    date:   { year: "numeric", month: "short", day: "numeric" },
    short:  { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
    medium: { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
    long:   { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" },
  };

  return new Intl.DateTimeFormat(locale, configs[precision]).format(d);
}

/**
 * Format a duration given in milliseconds as "Xh Ym Zs".
 * @example
 * formatDuration(3_723_000) // "1h 2m 3s"
 */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const hours   = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours)   parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Format a countdown given seconds remaining as "MM:SS" or "HH:MM:SS".
 * @example
 * formatCountdown(3723) // "1:02:03"
 * formatCountdown(90)   // "1:30"
 */
export function formatCountdown(totalSeconds: number): string {
  if (totalSeconds < 0) totalSeconds = 0;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

const RELATIVE_THRESHOLDS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "second", ms: 60_000 },
  { unit: "minute", ms: 3_600_000 },
  { unit: "hour",   ms: 86_400_000 },
  { unit: "day",    ms: 86_400_000 * 7 },
  { unit: "week",   ms: 86_400_000 * 30 },
  { unit: "month",  ms: 86_400_000 * 365 },
  { unit: "year",   ms: Infinity },
];

const DIVISORS: Partial<Record<Intl.RelativeTimeFormatUnit, number>> = {
  second: 1000,
  minute: 60_000,
  hour:   3_600_000,
  day:    86_400_000,
  week:   86_400_000 * 7,
  month:  86_400_000 * 30,
  year:   86_400_000 * 365,
};

/**
 * Return a human-readable relative time string.
 * @example
 * timeAgo(Date.now() - 65_000) // "1 minute ago"
 */
export function timeAgo(
  date: string | Date | number,
  locale = "en-US"
): string {
  const d = toDate(date);
  const diffMs = Date.now() - d.getTime();
  const absMs = Math.abs(diffMs);
  const sign = diffMs >= 0 ? -1 : 1; // negative = past

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const { unit, ms } of RELATIVE_THRESHOLDS) {
    if (absMs < ms) {
      const divisor = DIVISORS[unit] ?? 1;
      const value = Math.round((absMs / divisor) * sign);
      return rtf.format(value, unit);
    }
  }

  return rtf.format(Math.round((absMs / (86_400_000 * 365)) * sign), "year");
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/**
 * Add a given number of units to a date.
 * @example
 * addTime(new Date("2025-01-01"), 7, "days")
 */
export function addTime(
  date: string | Date | number,
  amount: number,
  unit: "seconds" | "minutes" | "hours" | "days" | "weeks" | "months" | "years"
): Date {
  const d = new Date(toDate(date));

  switch (unit) {
    case "seconds": d.setSeconds(d.getSeconds() + amount); break;
    case "minutes": d.setMinutes(d.getMinutes() + amount); break;
    case "hours":   d.setHours(d.getHours() + amount); break;
    case "days":    d.setDate(d.getDate() + amount); break;
    case "weeks":   d.setDate(d.getDate() + amount * 7); break;
    case "months":  d.setMonth(d.getMonth() + amount); break;
    case "years":   d.setFullYear(d.getFullYear() + amount); break;
  }

  return d;
}

/**
 * Get the difference between two dates in the specified unit.
 * @example
 * diffTime("2025-01-01", "2025-01-08", "days") // 7
 */
export function diffTime(
  dateA: string | Date | number,
  dateB: string | Date | number,
  unit: "seconds" | "minutes" | "hours" | "days" | "weeks"
): number {
  const msA = toDate(dateA).getTime();
  const msB = toDate(dateB).getTime();
  const diffMs = msB - msA;

  const divisors: Record<string, number> = {
    seconds: 1000,
    minutes: 60_000,
    hours:   3_600_000,
    days:    86_400_000,
    weeks:   86_400_000 * 7,
  };

  return Math.round(diffMs / divisors[unit]);
}

// ---------------------------------------------------------------------------
// Start / end of period
// ---------------------------------------------------------------------------

/** Return the start of the day (midnight) for a given date. */
export function startOfDay(date: string | Date | number): Date {
  const d = new Date(toDate(date));
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Return the end of the day (23:59:59.999) for a given date. */
export function endOfDay(date: string | Date | number): Date {
  const d = new Date(toDate(date));
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Return the start of the week (Monday) for a given date. */
export function startOfWeek(date: string | Date | number): Date {
  const d = new Date(toDate(date));
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Return the start of the month for a given date. */
export function startOfMonth(date: string | Date | number): Date {
  const d = new Date(toDate(date));
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/** Return true if `date` is before `other`. */
export function isBefore(
  date: string | Date | number,
  other: string | Date | number
): boolean {
  return toDate(date).getTime() < toDate(other).getTime();
}

/** Return true if `date` is after `other`. */
export function isAfter(
  date: string | Date | number,
  other: string | Date | number
): boolean {
  return toDate(date).getTime() > toDate(other).getTime();
}

/** Return true if `date` is between `start` and `end` (inclusive). */
export function isBetween(
  date: string | Date | number,
  start: string | Date | number,
  end: string | Date | number
): boolean {
  const t = toDate(date).getTime();
  return t >= toDate(start).getTime() && t <= toDate(end).getTime();
}

/** Return true if `date` is today (in local timezone). */
export function isToday(date: string | Date | number): boolean {
  const d = toDate(date);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

/**
 * Return true if the string is a valid parseable date.
 */
export function isValidDate(value: string | Date | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// Tournament helpers
// ---------------------------------------------------------------------------

/**
 * Return a "starts in X" / "started X ago" / "ended X ago" label for a
 * tournament given its start time and optional end time.
 */
export function tournamentTimeLabel(
  startTime: string | Date,
  endTime?: string | Date | null
): string {
  const now = Date.now();
  const start = toDate(startTime).getTime();
  const end = endTime ? toDate(endTime).getTime() : null;

  if (end !== null && now > end) return `Ended ${timeAgo(endTime!)}`;
  if (now < start) return `Starts ${timeAgo(startTime)}`;
  return `Started ${timeAgo(startTime)}`;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function toDate(value: string | Date | number): Date {
  return value instanceof Date ? value : new Date(value);
}
