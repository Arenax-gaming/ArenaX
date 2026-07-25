/**
 * Formatting helpers (#704 – Enhanced Utilities Library)
 *
 * Currency (XLM / tokens / NGN), dates, addresses, durations, file sizes.
 * No runtime dependencies beyond the standard browser/Node.js globals.
 */

// ─── Stellar / Token Formatting ──────────────────────────────────────────────

/**
 * Formats a XLM amount with up to 7 decimal places and appends ' XLM'.
 * @param amount  - numeric value or numeric string
 * @param decimals - number of decimal places (0–7, default 7)
 */
export function formatXLM(amount: number | string, decimals = 7): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!isFinite(n)) return "0.0000000 XLM";
  const clamped = Math.max(0, Math.min(7, Math.round(decimals)));
  return `${n.toFixed(clamped)} XLM`;
}

/**
 * Formats a token amount with the given symbol.
 * @param amount   - numeric value or numeric string
 * @param symbol   - token ticker (e.g. 'AX', 'USDC')
 * @param decimals - number of decimal places (default 2)
 */
export function formatToken(
  amount: number | string,
  symbol: string,
  decimals = 2
): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!isFinite(n)) return `0.${("0".repeat(decimals))} ${symbol}`;
  return `${n.toFixed(Math.max(0, decimals))} ${symbol}`;
}

/**
 * Formats a value as Nigerian Naira using the en-NG locale.
 * Falls back to a manual prefix if Intl is unavailable.
 */
export function formatNGN(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!isFinite(n)) return "₦0.00";
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `₦${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
  }
}

/**
 * Abbreviates large numbers with K / M / B suffixes.
 * @example formatLargeNumber(1_500_000) → '1.5M'
 */
export function formatLargeNumber(n: number): string {
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${sign}${abs}`;
}

// ─── Address Truncation ───────────────────────────────────────────────────────

/**
 * Truncates a Stellar address to a readable format, e.g. 'GBXXXX...YYYY'.
 * @param address - full 56-char Stellar public key
 * @param start   - chars to keep at the start (default 6)
 * @param end     - chars to keep at the end (default 4)
 */
export function truncateStellarAddress(
  address: string,
  start = 6,
  end = 4
): string {
  if (typeof address !== "string" || address.length === 0) return "";
  if (address.length <= start + end) return address;
  return `${address.slice(0, start)}...${address.slice(-end)}`;
}

// ─── Date & Time Formatting ───────────────────────────────────────────────────

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Converts a timestamp to a human-readable string: 'DD MMM YYYY, HH:MM'.
 * @param ts - Unix timestamp (ms), ISO string, or Date
 */
export function formatTimestamp(ts: number | string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (isNaN(d.getTime())) return "Invalid Date";
  const dd = String(d.getDate()).padStart(2, "0");
  const mon = MONTH_NAMES[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${dd} ${mon} ${yyyy}, ${hh}:${mm}`;
}

/**
 * Converts a duration in milliseconds to a readable string.
 * @example formatDuration(9000000) → '2h 30m'
 * @example formatDuration(45000)   → '45s'
 */
export function formatDuration(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

// ─── File Size Formatting ─────────────────────────────────────────────────────

/**
 * Formats a byte count as a human-readable file size.
 * @example formatFileSize(1536) → '1.50 KB'
 */
export function formatFileSize(bytes: number): string {
  if (!isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return i === 0 ? `${bytes} B` : `${value.toFixed(2)} ${units[i]}`;
}

// ─── Miscellaneous ────────────────────────────────────────────────────────────

/**
 * Formats a percentage from a value / total ratio.
 * @param value    - numerator
 * @param total    - denominator
 * @param decimals - decimal places (default 1)
 * @example formatPercentage(45, 100) → '45.0%'
 */
export function formatPercentage(
  value: number,
  total: number,
  decimals = 1
): string {
  if (!isFinite(value) || !isFinite(total) || total === 0) return "0%";
  const pct = (value / total) * 100;
  return `${pct.toFixed(Math.max(0, decimals))}%`;
}

/**
 * Returns the ordinal string for a number.
 * @example formatOrdinal(1) → '1st'
 * @example formatOrdinal(11) → '11th'
 */
export function formatOrdinal(n: number): string {
  const abs = Math.abs(Math.floor(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
