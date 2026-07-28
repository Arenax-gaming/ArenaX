import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  locales: ["en", "es", "ar", "fr", "yo"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];

/** Locales that require right-to-left layout direction. */
export const RTL_LOCALES: readonly Locale[] = ["ar"] as const;

/** Human-readable display names for each supported locale. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  ar: "العربية",
  fr: "Français",
  yo: "Yorùbá",
};

/** BCP-47 language tags used by Intl APIs. */
export const LOCALE_BCP47: Record<Locale, string> = {
  en: "en-US",
  es: "es-ES",
  ar: "ar-SA",
  fr: "fr-FR",
  yo: "yo-NG",
};

export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
