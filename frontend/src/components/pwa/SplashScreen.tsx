"use client";

/**
 * Installed-PWA splash screen (Issue #1267).
 *
 * Displays a brief branded splash when the app is launched from an installed
 * home-screen shortcut (display-mode: standalone, or the legacy iOS
 * `navigator.standalone` flag). It intentionally renders nothing in a normal
 * browser tab, and shows at most once per session so in-app navigation never
 * re-triggers it. Honours `prefers-reduced-motion` by shortening the dwell
 * time and disabling the transitions.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const SESSION_KEY = "arenax-splash-shown";
const FADE_MS = 400;
const VISIBLE_MS = 1600;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayModeMatch = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayModeMatch || iosStandalone;
}

export function SplashScreen() {
  const prefersReducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!isStandalone()) return;

    try {
      if (window.sessionStorage.getItem(SESSION_KEY)) return;
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // sessionStorage can throw in private/restricted contexts — skip the
      // splash rather than risk an unhandled error on launch.
      return;
    }

    setVisible(true);

    const dwell = prefersReducedMotion ? FADE_MS : VISIBLE_MS;
    const hideTimer = window.setTimeout(() => setLeaving(true), dwell);
    const removeTimer = window.setTimeout(() => setVisible(false), dwell + FADE_MS);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(removeTimer);
    };
  }, [prefersReducedMotion]);

  if (!visible) return null;

  return (
    <div
      role="presentation"
      aria-hidden="true"
      data-testid="pwa-splash-screen"
      className={[
        "fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4",
        "bg-background text-foreground",
        prefersReducedMotion ? "" : "transition-opacity duration-300 ease-out",
        leaving ? "opacity-0" : "opacity-100",
      ].join(" ")}
    >
      <Image
        src="/icons/icon-512x512.png"
        alt=""
        width={96}
        height={96}
        priority
        className="rounded-2xl shadow-lg"
      />
      <span className="text-2xl font-bold tracking-tight">ArenaX</span>
    </div>
  );
}

export default SplashScreen;
