"use client";

import { useEffect, useState } from "react";
import { useAnalytics } from "@/hooks/useAnalytics";

export function ConsentBanner() {
  const { getConsent, setConsent } = useAnalytics();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const { analytics } = getConsent();
    setVisible(analytics === "pending");
  }, [getConsent]);

  if (!visible) return null;

  function handleAccept() {
    setConsent("granted");
    setVisible(false);
  }

  function handleDecline() {
    setConsent("denied");
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed bottom-0 left-0 right-0 z-50 flex flex-col gap-3 bg-gray-900 p-4 text-sm text-gray-200 shadow-lg sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex-1">
        We use analytics to improve your experience. You can opt out at any time in{" "}
        <strong>Settings → Privacy</strong>.
      </p>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={handleDecline}
          className="rounded border border-gray-600 px-3 py-1.5 hover:bg-gray-800"
        >
          Decline
        </button>
        <button
          onClick={handleAccept}
          className="rounded bg-indigo-600 px-3 py-1.5 font-medium hover:bg-indigo-500"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
