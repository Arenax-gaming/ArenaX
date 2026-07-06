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

/**
 * `Omit` the upstream `formatter` because its parameter types conflict with
 * our consumer-facing signature (the base type's parameter is narrower than
 * what call sites actually pass at runtime when the tooltip is empty).
 *
 * `payload` / `label` are widened to optionals because the upstream
 * `TooltipProps` marks them as required context-derived properties; in
 * practice they are absent when the tooltip has no data.
 */
interface ChartTooltipProps
  extends Omit<TooltipProps<ValueType, NameType>, "formatter"> {
  active?: boolean;
  payload?: any[];
  label?: any;
  formatter?: (value: any, name: any) => string;
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
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: entry.color ?? entry.fill }}
            aria-hidden="true"
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-foreground">
            {formatter
              ? formatter(entry.value, entry.name)
              : String(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
