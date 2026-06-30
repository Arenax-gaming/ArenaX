/**
 * useFormAnalytics
 *
 * Tracks form interactions for analytics purposes.
 * Integrates with Datadog RUM when available; falls back to console in dev.
 *
 * Usage:
 *   const analytics = useFormAnalytics("login");
 *   analytics.trackStart();
 *   analytics.trackSubmit({ success: true });
 *   analytics.trackError("email", "Invalid email address");
 */
"use client";

import { useCallback, useRef } from "react";

type FormEvent =
  | { type: "form_start" }
  | { type: "form_submit"; success: boolean; durationMs: number }
  | { type: "form_error"; field: string; message: string }
  | { type: "form_abandon"; durationMs: number };

function sendEvent(formId: string, event: FormEvent) {
  // Datadog RUM integration — only runs client-side when RUM is initialised
  if (
    typeof window !== "undefined" &&
    // @ts-expect-error — DD_RUM is injected by @datadog/browser-rum
    typeof window.DD_RUM !== "undefined"
  ) {
    // @ts-expect-error
    window.DD_RUM.addAction(`form.${event.type}`, {
      form_id: formId,
      ...event,
    });
    return;
  }

  // Dev fallback
  if (process.env.NODE_ENV === "development") {
    console.debug("[FormAnalytics]", formId, event);
  }
}

export function useFormAnalytics(formId: string) {
  const startTimeRef = useRef<number | null>(null);

  const trackStart = useCallback(() => {
    startTimeRef.current = Date.now();
    sendEvent(formId, { type: "form_start" });
  }, [formId]);

  const trackSubmit = useCallback(
    (options: { success: boolean }) => {
      const durationMs = startTimeRef.current
        ? Date.now() - startTimeRef.current
        : 0;
      sendEvent(formId, {
        type: "form_submit",
        success: options.success,
        durationMs,
      });
      if (options.success) {
        startTimeRef.current = null;
      }
    },
    [formId]
  );

  const trackError = useCallback(
    (field: string, message: string) => {
      sendEvent(formId, { type: "form_error", field, message });
    },
    [formId]
  );

  const trackAbandon = useCallback(() => {
    if (!startTimeRef.current) return;
    const durationMs = Date.now() - startTimeRef.current;
    sendEvent(formId, { type: "form_abandon", durationMs });
    startTimeRef.current = null;
  }, [formId]);

  return { trackStart, trackSubmit, trackError, trackAbandon };
}
