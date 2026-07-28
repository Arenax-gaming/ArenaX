import { notFound } from "next/navigation";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

/**
 * Server-side i18n request configuration.
 *
 * Messages are loaded from per-locale JSON files that contain all
 * namespaces (common, auth, gameplay, settings, errors).  The import
 * is dynamic so each locale bundle is only fetched when that locale
 * is actually served — non-active locales are never sent to the client.
 */
export default getRequestConfig(async ({ locale }) => {
  // Reject unknown locales with a 404 instead of a cryptic runtime error.
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) {
    notFound();
  }

  const messages = (
    await import(`../messages/${locale}.json`)
  ).default;

  return {
    messages,
    // Forward the timezone so server and client agree on date formatting.
    timeZone: "UTC",
    // Provide a global onError handler so missing keys are surfaced in
    // dev/staging rather than silently returning the key string.
    onError(error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[i18n] Translation error:", error.message);
      }
    },
    // Return the raw key path on missing key so the UI still renders
    // something meaningful (shows developers exactly which key is absent).
    getMessageFallback({ namespace, key }) {
      return [namespace, key].filter(Boolean).join(".");
    },
  };
});
