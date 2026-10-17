/**
 * Multi-currency support beyond NGN (Issue #1263).
 *
 * Frontend counterpart to `server/src/services/currency.service.ts`. Holds the
 * currency catalogue, formatting/parsing helpers, and pure conversion maths.
 * Live exchange rates are fetched through the API and passed in, so this
 * module stays dependency-free and unit-testable.
 */

export type CurrencyCode = "NGN" | "USD" | "EUR" | "GBP" | "GHS" | "KES" | "ZAR";

export interface CurrencyInfo {
  code: CurrencyCode;
  symbol: string;
  name: string;
  decimals: number;
  locales: string[];
  /** Payment gateways that can settle this currency. */
  gateways: string[];
}

export const BASE_CURRENCY: CurrencyCode = "NGN";

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  NGN: {
    code: "NGN",
    symbol: "₦",
    name: "Nigerian Naira",
    decimals: 2,
    locales: ["en-NG"],
    gateways: ["paystack", "flutterwave"],
  },
  USD: {
    code: "USD",
    symbol: "$",
    name: "US Dollar",
    decimals: 2,
    locales: ["en-US"],
    gateways: ["stripe", "paypal"],
  },
  EUR: {
    code: "EUR",
    symbol: "€",
    name: "Euro",
    decimals: 2,
    locales: ["en-IE", "de-DE", "fr-FR"],
    gateways: ["stripe"],
  },
  GBP: {
    code: "GBP",
    symbol: "£",
    name: "British Pound",
    decimals: 2,
    locales: ["en-GB"],
    gateways: ["stripe"],
  },
  GHS: {
    code: "GHS",
    symbol: "₵",
    name: "Ghanaian Cedi",
    decimals: 2,
    locales: ["en-GH"],
    gateways: ["flutterwave"],
  },
  KES: {
    code: "KES",
    symbol: "KSh",
    name: "Kenyan Shilling",
    decimals: 2,
    locales: ["en-KE"],
    gateways: ["flutterwave"],
  },
  ZAR: {
    code: "ZAR",
    symbol: "R",
    name: "South African Rand",
    decimals: 2,
    locales: ["en-ZA"],
    gateways: ["flutterwave"],
  },
};

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function getCurrency(code: string): CurrencyInfo {
  return isCurrencyCode(code) ? CURRENCIES[code] : CURRENCIES[BASE_CURRENCY];
}

export function getSupportedCurrencies(): CurrencyInfo[] {
  return CURRENCY_CODES.map((code) => CURRENCIES[code]);
}

/** Payment gateways able to settle a currency; unknown codes fall back to NGN. */
export function getGatewaysFor(code: string): string[] {
  return getCurrency(code).gateways;
}

/**
 * Format an amount for display. Falls back to a manual `symbol + number` when
 * `Intl` is unavailable or the currency is not recognised by the runtime.
 */
export function formatCurrency(
  amount: number | string,
  code: CurrencyCode,
  locale?: string,
): string {
  const value = typeof amount === "string" ? parseFloat(amount) : amount;
  const info = CURRENCIES[code];
  if (!isFinite(value)) {
    return `${info.symbol}0.${"0".repeat(info.decimals)}`;
  }
  const resolvedLocale = locale ?? info.locales[0];
  try {
    return new Intl.NumberFormat(resolvedLocale, {
      style: "currency",
      currency: info.code,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(value);
  } catch {
    const fixed = value.toFixed(info.decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${info.symbol}${fixed}`;
  }
}

export function formatCurrencyByName(
  amount: number | string,
  code: string,
  locale?: string,
): string {
  return formatCurrency(amount, getCurrency(code).code, locale);
}

export interface ConvertResult {
  from: CurrencyCode;
  to: CurrencyCode;
  amount: number;
  converted: number;
  rate: number;
}

/** Units of each currency per 1 USD, used to derive offline fallback rates. */
const FALLBACK_USD_RATES: Record<CurrencyCode, number> = {
  NGN: 1550,
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  GHS: 12.6,
  KES: 129,
  ZAR: 18.4,
};

/**
 * Deterministic fallback rate table for a base currency, used when the live
 * exchange-rate endpoint is unavailable so conversions still render.
 */
export function fallbackRates(base: CurrencyCode): Record<string, number> {
  const baseUsd = FALLBACK_USD_RATES[base];
  const rates: Record<string, number> = {};
  for (const code of CURRENCY_CODES) {
    rates[code] = Number((FALLBACK_USD_RATES[code] / baseUsd).toFixed(6));
  }
  return rates;
}

/**
 * Convert `amount` between currencies using a rate table keyed by the base
 * currency (`rates[to]` = units of `to` per 1 unit of `from`).
 */
export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: Record<string, number>,
): ConvertResult {
  if (from === to) {
    return { from, to, amount, converted: amount, rate: 1 };
  }
  const rate = rates[to];
  if (!isFinite(amount) || rate === undefined || !isFinite(rate)) {
    throw new Error(`No exchange rate for ${from} -> ${to}`);
  }
  const decimals = CURRENCIES[to].decimals;
  return {
    from,
    to,
    amount,
    converted: Number((amount * rate).toFixed(decimals)),
    rate,
  };
}
