"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  BASE_CURRENCY,
  CurrencyCode,
  fallbackRates,
  isCurrencyCode,
} from "@/lib/currency";
import { useOptionalUserPreferences } from "@/contexts/UserPreferencesContext";

const STORAGE_KEY = "arenax_currency";

export interface ExchangeRates {
  base: string;
  rates: Record<string, number>;
  asOf: string;
  /** True when the values come from the offline fallback table. */
  isFallback: boolean;
}

/**
 * Exchange rates for a base currency (#1263). Falls back to a deterministic
 * offline table when the API is unavailable so the UI always renders a rate.
 */
export function useExchangeRates(base: CurrencyCode = BASE_CURRENCY) {
  return useQuery({
    queryKey: ["exchangeRates", base],
    queryFn: async (): Promise<ExchangeRates> => {
      try {
        const data = await api.getExchangeRates(base);
        return { ...data, isFallback: false };
      } catch {
        return {
          base,
          rates: fallbackRates(base),
          asOf: new Date().toISOString(),
          isFallback: true,
        };
      }
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * The player's preferred display currency. Reads/writes the shared
 * {@link UserPreferencesProvider} when mounted, otherwise persists to
 * localStorage directly so the selector works in isolation (and in tests).
 */
export function useCurrencyPreference() {
  const prefs = useOptionalUserPreferences();
  const [local, setLocal] = useState<CurrencyCode>(BASE_CURRENCY);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isCurrencyCode(stored)) setLocal(stored);
  }, []);

  const contextCurrency = prefs?.prefs.currency;
  const currency: CurrencyCode = isCurrencyCode(contextCurrency) ? contextCurrency : local;

  const setCurrency = useCallback(
    (next: CurrencyCode) => {
      if (prefs) {
        prefs.setCurrency(next);
      } else {
        setLocal(next);
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    },
    [prefs],
  );

  return { currency, setCurrency };
}
