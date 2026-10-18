"use client";

import { useExchangeRates } from "@/hooks/useCurrency";
import { CURRENCIES, CurrencyCode } from "@/lib/currency";

const DEFAULT_TARGETS: CurrencyCode[] = ["USD", "EUR", "GBP", "GHS", "KES"];

interface ExchangeRateDisplayProps {
  /** Currency the player is converting from. */
  base: CurrencyCode;
  /** Currencies to show alongside the base. */
  targets?: CurrencyCode[];
  /** Reference amount of `base` to quote. Defaults to 1. */
  amount?: number;
}

/** Renders `amount {base}` in each target currency (#1263). */
export function ExchangeRateDisplay({
  base,
  targets = DEFAULT_TARGETS,
  amount = 1,
}: ExchangeRateDisplayProps) {
  const { data, isLoading, isError } = useExchangeRates(base);

  if (isLoading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {targets.map((code) => (
          <div key={code} className="h-5 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return <p className="text-sm text-muted-foreground">Exchange rates unavailable.</p>;
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {targets
          .filter((code) => code !== base)
          .map((code) => {
            const rate = data.rates[code];
            if (rate === undefined) return null;
            const info = CURRENCIES[code];
            const converted = amount * rate;
            return (
              <li
                key={code}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-muted-foreground">
                  {amount} {CURRENCIES[base].code}
                </span>
                <span className="font-medium text-foreground">
                  ≈ {info.symbol}
                  {converted.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: converted < 1 ? 6 : 2,
                  })}{" "}
                  {code}
                </span>
              </li>
            );
          })}
      </ul>
      {data.isFallback && (
        <p className="text-xs text-muted-foreground">
          Indicative rates — live feed temporarily unavailable.
        </p>
      )}
    </div>
  );
}

export default ExchangeRateDisplay;
