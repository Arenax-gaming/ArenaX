"use client";

import { CurrencyCode, getSupportedCurrencies } from "@/lib/currency";

interface CurrencySelectorProps {
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
  id?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Native currency picker (#1263). Presentational — the selected value is owned
 * by the caller (see `useCurrencyPreference`) so the preference can be shared
 * across the wallet and persisted in one place.
 */
export function CurrencySelector({
  value,
  onChange,
  id = "currency-selector",
  className,
  disabled,
}: CurrencySelectorProps) {
  const currencies = getSupportedCurrencies();

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
        Currency
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as CurrencyCode)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {currencies.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.symbol} {currency.code} — {currency.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export default CurrencySelector;
