"use client";

import React from "react";
import { ChevronUp, ChevronDown, Minus } from "lucide-react";

interface RankChangeProps {
  change?: number | null;
  className?: string;
}

export const RankChange: React.FC<RankChangeProps> = ({
  change,
  className = "",
}) => {
  if (change === null || change === undefined) {
    return (
      <div className={`flex items-center gap-1 text-muted-foreground ${className}`}>
        <Minus className="w-4 h-4" />
        <span className="text-xs">—</span>
      </div>
    );
  }

  if (change === 0) {
    return (
      <div className={`flex items-center gap-1 text-muted-foreground ${className}`}>
        <Minus className="w-4 h-4" />
        <span className="text-xs">0</span>
      </div>
    );
  }

  const isPositive = change > 0;
  const color = isPositive ? "text-success" : "text-destructive";
  const bgColor = isPositive ? "bg-success/10" : "bg-destructive/10";

  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded ${bgColor} ${color} ${className}`}
    >
      {isPositive ? (
        <ChevronUp className="w-4 h-4" />
      ) : (
        <ChevronDown className="w-4 h-4" />
      )}
      <span className="text-xs font-semibold">{Math.abs(change)}</span>
    </div>
  );
};
