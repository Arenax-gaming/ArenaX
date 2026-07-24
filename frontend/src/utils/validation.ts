/**
 * Validation helpers (#704 – Enhanced Utilities Library)
 *
 * Pure functions with no runtime dependencies.
 * All validators return a boolean and never throw.
 */

/**
 * Validates an email address against a practical RFC5322-like pattern.
 * Handles the vast majority of real-world addresses without over-engineering.
 */
export function isValidEmail(email: string): boolean {
  if (typeof email !== "string" || email.trim().length === 0) return false;
  // Local part @ domain.tld  (local ≤ 64 chars, total ≤ 254)
  const pattern =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  return email.length <= 254 && pattern.test(email.trim());
}

/**
 * Validates a Stellar public key (G… 56-char base32 string).
 */
export function isValidStellarAddress(address: string): boolean {
  if (typeof address !== "string") return false;
  // Stellar public keys: exactly 56 chars, start with 'G', base32 alphabet
  return /^G[A-Z2-7]{55}$/.test(address);
}

/**
 * Validates a Stellar transaction memo (max 28 bytes UTF-8).
 */
export function isValidStellarMemo(memo: string): boolean {
  if (typeof memo !== "string") return false;
  const byteLength = new TextEncoder().encode(memo).length;
  return byteLength <= 28;
}

/**
 * Validates a username:
 * – 3 to 20 characters
 * – Alphanumeric + underscore only
 * – Must not start or end with an underscore
 */
export function isValidUsername(username: string): boolean {
  if (typeof username !== "string") return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9_]{1,18}[a-zA-Z0-9]$|^[a-zA-Z0-9]{1,20}$/.test(
    username
  ) && !username.startsWith("_") && !username.endsWith("_") &&
    username.length >= 3 && username.length <= 20;
}

/**
 * Validates a phone number in E.164 format.
 * Allows an optional leading '+', then 7–15 digits.
 */
export function isValidPhoneNumber(phone: string): boolean {
  if (typeof phone !== "string") return false;
  return /^\+?[0-9]{7,15}$/.test(phone.trim());
}

/**
 * Returns true if value is a number (or numeric string) and > 0.
 */
export function isPositiveNumber(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  const n = Number(value);
  return isFinite(n) && n > 0;
}

/**
 * Returns true if value can be parsed as a positive, finite number.
 * Accepts both string and number inputs.
 */
export function isValidAmount(amount: string | number): boolean {
  if (amount === "" || amount === null || amount === undefined) return false;
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return isFinite(n) && n > 0;
}

/**
 * Type guard: returns true (and narrows to `string`) if value is a non-empty
 * string after trimming.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Returns true if the string is a valid http:// or https:// URL.
 */
export function isValidUrl(url: string): boolean {
  if (typeof url !== "string" || url.trim().length === 0) return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
