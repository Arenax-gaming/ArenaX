/**
 * number.ts — numeric utility library
 *
 * Pure functions — no side effects, no browser dependencies.
 */

// ---------------------------------------------------------------------------
// Clamping & rounding
// ---------------------------------------------------------------------------

/** Clamp `n` to the range [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * Round `n` to `decimals` decimal places.
 * @example
 * roundTo(3.14159, 2) // 3.14
 */
export function roundTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

/** Round down to `decimals` places. */
export function floorTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.floor(n * factor) / factor;
}

/** Round up to `decimals` places. */
export function ceilTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.ceil(n * factor) / factor;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a number with locale-appropriate thousands separators.
 * @example
 * formatNumber(1234567.89, "en-US") // "1,234,567.89"
 */
export function formatNumber(
  n: number,
  locale = "en-US",
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(locale, options).format(n);
}

/**
 * Format a number as a compact representation.
 * @example
 * formatCompact(12500) // "12.5K"
 * formatCompact(2300000) // "2.3M"
 */
export function formatCompact(n: number, decimals = 1): string {
  if (Math.abs(n) < 1_000) return String(n);
  const tiers = [
    { threshold: 1_000_000_000, suffix: "B" },
    { threshold: 1_000_000, suffix: "M" },
    { threshold: 1_000, suffix: "K" },
  ];
  for (const { threshold, suffix } of tiers) {
    if (Math.abs(n) >= threshold) {
      return `${roundTo(n / threshold, decimals)}${suffix}`;
    }
  }
  return String(n);
}

/**
 * Format a number as a percentage string.
 * @example
 * formatPercent(0.756) // "75.6%"
 * formatPercent(75.6, { alreadyPercent: true }) // "75.6%"
 */
export function formatPercent(
  n: number,
  options: { decimals?: number; alreadyPercent?: boolean } = {}
): string {
  const { decimals = 1, alreadyPercent = false } = options;
  const value = alreadyPercent ? n : n * 100;
  return `${roundTo(value, decimals)}%`;
}

/**
 * Format an ordinal number: 1 → "1st", 2 → "2nd", 11 → "11th"
 */
export function formatOrdinal(n: number): string {
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  const mod10 = abs % 10;

  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (mod10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

// ---------------------------------------------------------------------------
// ELO & gaming helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the expected score for a player in an ELO matchup.
 * Returns the probability that `playerElo` beats `opponentElo`.
 */
export function eloExpectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

/**
 * Calculate the new ELO rating after a match.
 * @param currentElo  Player's current ELO
 * @param opponentElo Opponent's ELO
 * @param score       1 = win, 0.5 = draw, 0 = loss
 * @param kFactor     K-factor (default 32)
 */
export function calculateNewElo(
  currentElo: number,
  opponentElo: number,
  score: 0 | 0.5 | 1,
  kFactor = 32
): number {
  const expected = eloExpectedScore(currentElo, opponentElo);
  return Math.round(currentElo + kFactor * (score - expected));
}

/**
 * Calculate win rate as a percentage (0–100).
 */
export function winRate(wins: number, totalGames: number): number {
  if (totalGames === 0) return 0;
  return roundTo((wins / totalGames) * 100, 1);
}

// ---------------------------------------------------------------------------
// Random
// ---------------------------------------------------------------------------

/**
 * Return a random integer in [min, max] (inclusive).
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Return a random float in [min, max).
 */
export function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// ---------------------------------------------------------------------------
// Range / interpolation
// ---------------------------------------------------------------------------

/**
 * Linear interpolation between `a` and `b` at fraction `t` (0–1).
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Inverse of lerp — given a value `v` between `a` and `b`, return `t`.
 */
export function inverseLerp(a: number, b: number, v: number): number {
  if (a === b) return 0;
  return clamp((v - a) / (b - a), 0, 1);
}

/**
 * Remap `v` from range [inMin, inMax] to range [outMin, outMax].
 */
export function remap(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  const t = inverseLerp(inMin, inMax, v);
  return lerp(outMin, outMax, t);
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/** Return true if `n` is even. */
export function isEven(n: number): boolean {
  return n % 2 === 0;
}

/** Return true if `n` is odd. */
export function isOdd(n: number): boolean {
  return Math.abs(n % 2) === 1;
}

/** Return the sign of `n`: -1, 0, or 1. */
export function sign(n: number): -1 | 0 | 1 {
  if (n < 0) return -1;
  if (n > 0) return 1;
  return 0;
}

/** Greatest common divisor (Euclidean algorithm). */
export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Least common multiple. */
export function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

/** Sum of digits of a non-negative integer. */
export function digitSum(n: number): number {
  return String(Math.abs(Math.trunc(n)))
    .split("")
    .reduce((acc, d) => acc + Number(d), 0);
}
