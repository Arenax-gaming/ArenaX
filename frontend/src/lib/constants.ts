/**
 * Canonical API base URL used by all hooks and the ApiClient.
 *
 * `NEXT_PUBLIC_API_URL` should point to the API origin **without** any path
 * suffix (e.g. `https://api.arenax.com`).  The `/api/v1` path prefix is
 * appended here so every caller automatically resolves to the correct
 * versioned path without each hook needing to duplicate the suffix.
 *
 * In development the value falls back to the local Next.js dev server which
 * proxies `/api/*` routes, so the local base is simply `/api/v1`.
 */
export const API_BASE: string = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/v1`
  : "http://localhost:3000/api/v1";
