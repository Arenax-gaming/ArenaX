"use client";

/**
 * Branded PWA install prompt (Issue #858).
 *
 * The default browser prompt is a grey bar that says "Add to Home screen" and
 * gives no reason to. This replaces it with an ArenaX-branded card that states
 * what installing actually buys the player, remembers a dismissal for 30 days,
 * and reports the whole funnel per cohort so the install rate is measurable
 * rather than assumed.
 */

import { useCallback, useEffect, useState } from "react";
import { Bell, Download, Gauge, WifiOff, X } from "lucide-react";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import {
  DISMISSAL_DAYS,
  getPwaCohort,
  isPromptSuppressed,
  recordPromptShown,
  suppressPromptAfterDismissal,
  trackPwaEvent,
  type PwaCohort,
} from "@/lib/pwaInstall";

interface Benefit {
  icon: typeof Gauge;
  label: string;
}

/**
 * The benefits are concrete and player-facing.
 *
 * "Works offline" is a fact about the app; "Keep playing on the train" is a
 * reason to install. The second is what moves an install rate.
 */
const BENEFITS: Record<PwaCohort, { headline: string; sub: string; benefits: Benefit[] }> = {
  benefits: {
    headline: "Install ArenaX",
    sub: "Full-screen play, no browser bar, one tap from your home screen.",
    benefits: [
      { icon: Bell, label: "Match alerts even when the app is closed" },
      { icon: WifiOff, label: "Browse tournaments on a bad connection" },
      { icon: Gauge, label: "Opens instantly — no page load" },
    ],
  },
  speed: {
    headline: "Get the faster ArenaX",
    sub: "The installed app skips the browser entirely.",
    benefits: [
      { icon: Gauge, label: "Launches in under a second" },
      { icon: Bell, label: "Never miss a match invite" },
      { icon: WifiOff, label: "Keeps working when your signal drops" },
    ],
  },
};

export function PwaInstallPrompt() {
  const { isInstallable, isInstalled, install } = usePwaInstall();
  const [dismissed, setDismissed] = useState(false);
  // Suppression is read once on mount rather than during render: localStorage
  // is unavailable on the server, and reading it during render would make the
  // first client paint disagree with the server's HTML.
  const [suppressed, setSuppressed] = useState(true);
  const [cohort, setCohort] = useState<PwaCohort>("benefits");

  useEffect(() => {
    setSuppressed(isPromptSuppressed());
    setCohort(getPwaCohort());
  }, []);

  const visible = isInstallable && !isInstalled && !dismissed && !suppressed;

  // Fires once per appearance, not once per render, so the funnel denominator
  // is "times a user saw it" rather than "times React re-rendered".
  useEffect(() => {
    if (!visible) return;
    recordPromptShown();
    trackPwaEvent("pwa_prompt_shown");
  }, [visible]);

  useEffect(() => {
    if (isInstalled) trackPwaEvent("pwa_installed");
  }, [isInstalled]);

  const handleDismiss = useCallback(() => {
    const until = suppressPromptAfterDismissal();
    setDismissed(true);
    trackPwaEvent("pwa_prompt_dismissed", {
      suppressed_until: new Date(until).toISOString(),
      suppression_days: DISMISSAL_DAYS,
    });
  }, []);

  const handleInstall = useCallback(async () => {
    try {
      const outcome = await install();

      // Tracked on the browser's answer, not on the click: a user who taps
      // "Install App" and then cancels the system dialog has not installed,
      // and counting them would inflate the rate this exists to measure.
      if (outcome === "accepted") {
        trackPwaEvent("pwa_install_accepted");
        return;
      }

      trackPwaEvent("pwa_install_declined", { reason: outcome });
      // A cancelled system dialog is a soft no — suppress for the same window
      // as an explicit dismissal rather than re-offering on the next route.
      suppressPromptAfterDismissal();
      setDismissed(true);
    } catch {
      trackPwaEvent("pwa_install_declined", { reason: "prompt_failed" });
      setDismissed(true);
    }
  }, [install]);

  if (!visible) return null;

  const copy = BENEFITS[cohort];

  return (
    <div
      className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-sm"
      role="dialog"
      aria-labelledby="pwa-prompt-title"
      aria-describedby="pwa-prompt-description"
      data-cohort={cohort}
      data-testid="pwa-install-prompt"
    >
      <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Branded header strip */}
        <div className="flex items-start justify-between gap-3 bg-gradient-to-r from-indigo-600 to-violet-600 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-white/15 p-2 backdrop-blur">
              <Download className="h-5 w-5 text-white" aria-hidden="true" />
            </div>
            <div>
              <p id="pwa-prompt-title" className="text-sm font-semibold text-white">
                {copy.headline}
              </p>
              <p id="pwa-prompt-description" className="text-xs text-indigo-100">
                {copy.sub}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="shrink-0 rounded-lg p-1 text-indigo-100 transition-colors hover:bg-white/15 hover:text-white"
            aria-label={`Dismiss install prompt for ${DISMISSAL_DAYS} days`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul className="flex flex-col gap-2.5 px-4 py-3.5">
          {copy.benefits.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2.5 text-xs text-gray-300">
              <Icon className="h-4 w-4 shrink-0 text-indigo-400" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 border-t border-gray-800 px-4 py-3">
          <button
            type="button"
            onClick={handleDismiss}
            className="rounded-lg px-3 py-2 text-xs font-medium text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={handleInstall}
            className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            Install App
          </button>
        </div>
      </div>
    </div>
  );
}
