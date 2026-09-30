"use client";

import { useEffect, useState } from "react";
import { useConsentStore } from "@/hooks/useConsentStore";
import type { ConsentChoices } from "@/lib/consentPreferences";

/** Dispatched by the footer's "Manage cookies" link to reopen this banner with current choices pre-filled (#1093). */
export const OPEN_CONSENT_MODAL_EVENT = "arenax:consent-open-modal";

const CATEGORY_COPY: Record<
  keyof ConsentChoices,
  { label: string; description: string }
> = {
  performance: {
    label: "Performance",
    description: "Web Vitals and load-time metrics, used to find and fix slow pages.",
  },
  analytics: {
    label: "Analytics",
    description: "Session recording and usage analytics (Datadog RUM), used to understand feature usage.",
  },
  personalisation: {
    label: "Personalisation",
    description: "Form interaction tracking, used to tailor onboarding and reduce friction.",
  },
};

export function ConsentBanner() {
  const { hasDecided, choices, grant, revoke, save } = useConsentStore();
  const [manageOpen, setManageOpen] = useState(false);
  const [draft, setDraft] = useState<ConsentChoices>(choices);

  useEffect(() => {
    function handleReopen() {
      setDraft(choices);
      setManageOpen(true);
    }
    window.addEventListener(OPEN_CONSENT_MODAL_EVENT, handleReopen);
    return () => window.removeEventListener(OPEN_CONSENT_MODAL_EVENT, handleReopen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = !hasDecided || manageOpen;
  if (!visible) return null;

  function handleAcceptAll() {
    grant();
    setManageOpen(false);
  }

  function handleDeclineAll() {
    revoke();
    setManageOpen(false);
  }

  function openManage() {
    setDraft(choices);
    setManageOpen(true);
  }

  function handleSavePreferences() {
    save(draft);
    setManageOpen(false);
  }

  if (manageOpen) {
    return (
      <div
        role="dialog"
        aria-label="Manage cookie preferences"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      >
        <div className="w-full max-w-md rounded-lg bg-gray-900 p-5 text-sm text-gray-200 shadow-xl">
          <h2 className="mb-1 text-base font-semibold text-white">Manage cookie preferences</h2>
          <p className="mb-4 text-gray-400">
            Essential cookies are always on — the app can&apos;t function without them.
            Choose which optional categories you&apos;re comfortable with.
          </p>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3 rounded border border-gray-700 p-3 opacity-70">
              <div>
                <p className="font-medium text-white">Essential</p>
                <p className="text-xs text-gray-400">Required for login, security, and core functionality.</p>
              </div>
              <input type="checkbox" checked disabled aria-label="Essential (always on)" />
            </div>

            {(Object.keys(CATEGORY_COPY) as (keyof ConsentChoices)[]).map((category) => (
              <div
                key={category}
                className="flex items-start justify-between gap-3 rounded border border-gray-700 p-3"
              >
                <div>
                  <p className="font-medium text-white">{CATEGORY_COPY[category].label}</p>
                  <p className="text-xs text-gray-400">{CATEGORY_COPY[category].description}</p>
                </div>
                <input
                  type="checkbox"
                  checked={draft[category]}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [category]: e.target.checked }))
                  }
                  aria-label={CATEGORY_COPY[category].label}
                />
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              onClick={handleDeclineAll}
              className="rounded border border-gray-600 px-3 py-1.5 hover:bg-gray-800"
            >
              Decline All
            </button>
            <button
              onClick={handleSavePreferences}
              className="rounded border border-gray-600 px-3 py-1.5 hover:bg-gray-800"
            >
              Save Preferences
            </button>
            <button
              onClick={handleAcceptAll}
              className="rounded bg-indigo-600 px-3 py-1.5 font-medium hover:bg-indigo-500"
            >
              Accept All
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-0 left-0 right-0 z-50 flex flex-col gap-3 bg-gray-900 p-4 text-sm text-gray-200 shadow-lg sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex-1">
        We use optional cookies for performance, analytics, and personalisation. You can
        choose exactly which ones to allow, and change your mind any time in{" "}
        <strong>Manage cookies</strong>.
      </p>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button
          onClick={handleDeclineAll}
          className="rounded border border-gray-600 px-3 py-1.5 hover:bg-gray-800"
        >
          Decline
        </button>
        <button
          onClick={openManage}
          className="rounded border border-gray-600 px-3 py-1.5 hover:bg-gray-800"
        >
          Customize
        </button>
        <button
          onClick={handleAcceptAll}
          className="rounded bg-indigo-600 px-3 py-1.5 font-medium hover:bg-indigo-500"
        >
          Accept All
        </button>
      </div>
    </div>
  );
}
