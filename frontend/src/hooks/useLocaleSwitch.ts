"use client";

import { useLocale } from "next-intl";
import { useCallback } from "react";
import { useRouter, usePathname } from "@/i18n/routing";
import { type Locale, LOCALE_LABELS } from "@/i18n/routing";
import { persistLocale } from "@/i18n/localeDetection";
import { trackLocaleChange } from "@/i18n/monitoring";

export interface UseLocaleSwitchReturn {
  /** Currently active locale code, e.g. "en" */
  locale: Locale;
  /** Human-readable label for the current locale, e.g. "English" */
  localeLabel: string;
  /**
   * Switch to a new locale.
   * - Persists the choice in localStorage
   * - Emits an analytics event
   * - Re-navigates to the same path under the new locale prefix
   */
  switchLocale: (
    next: Locale,
    source?: "user" | "auto-detect" | "url-param" | "storage"
  ) => void;
}

/**
 * Hook for locale switching across the ArenaX application.
 *
 * Usage:
 * ```tsx
 * const { locale, localeLabel, switchLocale } = useLocaleSwitch();
 * switchLocale("fr");
 * ```
 */
export function useLocaleSwitch(): UseLocaleSwitchReturn {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = useCallback(
    (
      next: Locale,
      source: "user" | "auto-detect" | "url-param" | "storage" = "user"
    ) => {
      if (next === locale) return;

      // Persist so the user's preference is remembered across sessions
      persistLocale(next);

      // Fire analytics event (best-effort)
      trackLocaleChange(locale, next, source);

      // Navigate to the same page under the new locale prefix.
      // next-intl's router handles the /[locale]/ segment automatically.
      router.replace(pathname, { locale: next });
    },
    [locale, router, pathname]
  );

  return {
    locale,
    localeLabel: LOCALE_LABELS[locale] ?? locale,
    switchLocale,
  };
}
