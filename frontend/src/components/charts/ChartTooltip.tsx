/**
 * ChartTooltip — consistent Recharts custom tooltip using ArenaX design tokens.
 *
 * Usage:
 *   <Tooltip content={<ChartTooltip />} />
 *
 * Accepts an optional `formatter` to customise value labels.
 */
"use client";

import React from "react";
import type { TooltipProps } from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";

interface ChartTooltipProps extends TooltipProps<ValueType, NameType> {
  formatter?: (value: ValueType, name: NameType) => string;
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatter,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div
      role="tooltip"
      className="rounded border bg-card text-card-foreground p-3 shadow-md text-xs space-y-1"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {label && (
        <p className="font-semibold text-foreground mb-1">{String(label)}</p>
      )}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color ?? entry.fill }}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-foreground">
            {formatter
              ? formatter(entry.value as ValueType, entry.name as NameType)
              : String(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
