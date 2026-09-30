/**
 * Datadog RUM error reporting helper — Issue #1100.
 *
 * Centralises the call to `datadogRum.addError` so every error boundary
 * reports caught errors to the monitoring service with user context, PII
 * stripped, and without ever letting a monitoring failure break the app.
 */

"use client";

import { datadogRum } from "@datadog/browser-rum";
import { redactContext, redactErrorForMonitoring } from "./pii";

function getCurrentUserId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const directId = localStorage.getItem("user_id");
  if (directId) return directId;
  try {
    const raw = localStorage.getItem("arenax_auth_user");
    if (raw) {
      const parsed = JSON.parse(raw) as { id?: string; userId?: string };
      return parsed.id ?? parsed.userId;
    }
  } catch {
    // Ignore malformed stored auth payload.
  }
  return undefined;
}

function getCurrentRoute(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return window.location.pathname;
}

/**
 * Reports an error to Datadog RUM with PII-stripped message/context and
 * optional user + route identification. Never throws.
 */
export function reportErrorToDatadog(
  error: Error,
  context?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;

  const safeContext = redactContext(context ?? {}) as Record<string, unknown>;
  if (safeContext.userId === undefined) {
    const userId = getCurrentUserId();
    if (userId) safeContext.userId = userId;
  }
  if (safeContext.route === undefined) {
    const route = getCurrentRoute();
    if (route) safeContext.route = route;
  }

  try {
    datadogRum.addError(redactErrorForMonitoring(error), safeContext);
  } catch {
    // Monitoring must never break error handling or the app.
  }
}