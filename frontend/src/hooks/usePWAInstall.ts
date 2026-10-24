"use client";

/**
 * usePWAInstall — custom PWA install flow (Issues #858, #1414).
 *
 * - Captures and defers `beforeinstallprompt` (Chrome / Edge / Samsung
 *   Internet on Android and desktop). The listener is attached when this
 *   module first loads on the client, not in an effect, because the browser
 *   can fire the event before React hydrates and a late listener misses it.
 * - Safari on iOS never fires that event; `platform === "ios"` tells the UI
 *   to show "Share → Add to Home Screen" instructions instead.
 * - `shouldShow` folds in installed state and the 30-day dismissal window
 *   stored in localStorage (see `lib/pwaInstall`).
 * - `promptInstall()` shows the deferred browser dialog and records the
 *   user's choice.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  isPromptSuppressed,
  recordInstallOutcome,
  suppressPromptAfterDismissal,
} from "@/lib/pwaInstall";

/**
 * What `promptInstall()` resolved to. `"unavailable"` means the browser never
 * offered a prompt to defer, so nothing was shown at all.
 */
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/** How the app can be installed on this device. */
export type InstallPlatform =
  /** A deferred `beforeinstallprompt` is (or may become) available. */
  | "prompt"
  /** iOS / iPadOS: manual "Add to Home Screen" from the Share sheet. */
  | "ios"
  /** No supported install path in this browser. */
  | "unsupported";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

// ─── Module-level capture ─────────────────────────────────────────────────────

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedViaEvent = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event: Event) => {
    // Stop the mini-infobar; we show our own banner instead.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installedViaEvent = true;
    deferredPrompt = null;
    recordInstallOutcome("accepted");
    notify();
  });
}

/** Test hook: inject or clear a deferred prompt. */
export function __setDeferredPromptForTests(event: BeforeInstallPromptEvent | null) {
  deferredPrompt = event;
  installedViaEvent = false;
  notify();
}

// ─── Platform detection ───────────────────────────────────────────────────────

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari home-screen apps.
    nav.standalone === true
  );
}

export function isIosDevice(userAgent?: string, maxTouchPoints?: number): boolean {
  if (typeof navigator === "undefined" && userAgent === undefined) return false;
  const ua = userAgent ?? navigator.userAgent;
  const touch = maxTouchPoints ?? (typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0);
  // iPadOS 13+ reports a Mac user agent; touch support gives it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
}

/** Only Safari itself can add to the home screen on iOS < 16.4. */
export function isIosSafari(userAgent?: string): boolean {
  const ua = userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function detectPlatform(): InstallPlatform {
  if (typeof window === "undefined") return "unsupported";
  if (isIosDevice()) return "ios";
  if ("onbeforeinstallprompt" in window || deferredPrompt) return "prompt";
  return "unsupported";
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePWAInstall() {
  const prompt = useSyncExternalStore(
    subscribe,
    () => deferredPrompt,
    () => null
  );
  const installedEvent = useSyncExternalStore(
    subscribe,
    () => installedViaEvent,
    () => false
  );

  // Read client-only state after mount so server HTML and the first client
  // render agree (localStorage / matchMedia don't exist on the server).
  const [mounted, setMounted] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("unsupported");
  const [standalone, setStandalone] = useState(false);
  const [suppressed, setSuppressed] = useState(true);
  const [lastOutcome, setLastOutcome] = useState<InstallOutcome | null>(null);

  useEffect(() => {
    setMounted(true);
    setPlatform(detectPlatform());
    setStandalone(isStandaloneDisplay());
    setSuppressed(isPromptSuppressed());

    const media = window.matchMedia?.("(display-mode: standalone)");
    const onChange = () => setStandalone(isStandaloneDisplay());
    media?.addEventListener?.("change", onChange);
    return () => media?.removeEventListener?.("change", onChange);
  }, []);

  const isInstalled = standalone || installedEvent || lastOutcome === "accepted";
  const isInstallable = prompt !== null;
  const isIOS = platform === "ios";
  const canInstall = isInstallable || isIOS;
  const shouldShow = mounted && canInstall && !isInstalled && !suppressed;

  /**
   * Show the browser's install dialog and record the user's choice.
   *
   * Returns what the user chose (Issue #858): an install rate is
   * accepted-over-shown, and without the outcome a dismissal at the browser
   * dialog is indistinguishable from an install.
   */
  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const event = deferredPrompt;
    if (!event) return "unavailable";

    await event.prompt();
    const { outcome } = await event.userChoice;
    // A deferred prompt can only be used once.
    deferredPrompt = null;
    notify();

    recordInstallOutcome(outcome);
    setLastOutcome(outcome);
    return outcome;
  }, []);

  /** Hide the banner for `DISMISSAL_DAYS` (30) days on this device. */
  const dismiss = useCallback(() => {
    const until = suppressPromptAfterDismissal();
    setSuppressed(true);
    return until;
  }, []);

  return {
    /** `beforeinstallprompt` was captured and can be triggered. */
    isInstallable,
    isInstalled,
    /** iOS: show manual Add-to-Home-Screen instructions. */
    isIOS,
    /** iOS in a non-Safari browser, where Add to Home Screen may be missing. */
    isIOSNonSafari: isIOS && !isIosSafari(),
    platform,
    /** Banner should be visible: installable, not installed, not dismissed. */
    shouldShow,
    lastOutcome,
    promptInstall,
    /** Alias of `promptInstall`, kept for the #858 API. */
    install: promptInstall,
    dismiss,
  };
}

/** Back-compat alias for the #858 name. */
export const usePwaInstall = usePWAInstall;
