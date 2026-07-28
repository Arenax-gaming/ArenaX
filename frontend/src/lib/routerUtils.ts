/**
 * Imperative navigation helper for use in class components and other contexts
 * where React hooks are unavailable.
 *
 * `navigate` is wired up once at app startup by `RouterInitializer`. Until it
 * is wired, calls fall back to `window.location.assign` so there is always a
 * working implementation (e.g. during SSR safety checks or test environments).
 *
 * Usage in a class component:
 *
 *   import { navigate } from "@/lib/routerUtils";
 *   // ...
 *   navigate("/login");
 */

type NavigateFn = (url: string) => void;

let _navigate: NavigateFn = (url: string) => {
  if (typeof window !== "undefined") {
    window.location.assign(url);
  }
};

/**
 * Called once by `RouterInitializer` to inject the Next.js App Router's
 * `push` function so all subsequent `navigate()` calls use client-side
 * routing instead of a hard page reload.
 */
export function setNavigate(fn: NavigateFn): void {
  _navigate = fn;
}

/**
 * Navigate to `url` using the Next.js router (client-side, no full reload).
 * Falls back to `window.location.assign` if the router has not been wired yet.
 */
export function navigate(url: string): void {
  _navigate(url);
}
