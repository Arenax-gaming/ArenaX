"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface VoteBreakdownChartProps {
  yes: number;
  no: number;
  abstain: number;
  className?: string;
}

/**
 * Horizontal stacked bar showing yes / no / abstain proportions.
 * Pure CSS — no recharts dependency for this small widget.
 */
export function VoteBreakdownChart({
  yes,
  no,
  abstain,
  className,
}: VoteBreakdownChartProps) {
  const total = yes + no + abstain;

  const yesPct = total === 0 ? 0 : Math.round((yes / total) * 100);
  const noPct = total === 0 ? 0 : Math.round((no / total) * 100);
  const abstainPct = total === 0 ? 100 : Math.max(0, 100 - yesPct - noPct);

  const segments = [
    {
      label: "Yes",
      count: yes,
      pct: yesPct,
      bg: "bg-green-500",
      text: "text-green-600 dark:text-green-400",
    },
    {
      label: "No",
      count: no,
      pct: noPct,
      bg: "bg-red-500",
      text: "text-red-600 dark:text-red-400",
    },
    {
      label: "Abstain",
      count: abstain,
      pct: abstainPct,
      bg: "bg-gray-400 dark:bg-gray-600",
      text: "text-muted-foreground",
    },
  ];

  return (
    <div className={cn("space-y-3", className)}>
      {/* Stacked bar */}
      <div
        className="flex h-4 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Vote breakdown: ${yes} yes, ${no} no, ${abstain} abstain`}
      >
        {total === 0 ? (
          <div className="h-full w-full bg-muted" />
        ) : (
          segments.map((s) =>
            s.pct > 0 ? (
              <div
                key={s.label}
                className={cn("h-full transition-all duration-500", s.bg)}
                style={{ width: `${s.pct}%` }}
              />
            ) : null
          )
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", s.bg)} aria-hidden="true" />
            <span className="text-muted-foreground">{s.label}</span>
            <span className={cn("font-semibold tabular-nums", s.text)}>
              {s.count}
            </span>
            {total > 0 && (
              <span className="text-muted-foreground/70 text-xs">
                ({s.pct}%)
              </span>
            )}
          </div>
        ))}
        <div className="ml-auto text-muted-foreground text-xs self-center">
          {total} total vote{total !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}
