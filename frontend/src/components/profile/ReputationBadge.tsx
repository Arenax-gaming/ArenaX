"use client";

import { Shield, ShieldCheck, ShieldAlert, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReputationTier, TIER_CONFIG } from "@/hooks/useReputation";

interface ReputationBadgeProps {
  tier: ReputationTier;
  score: number;
  /** compact = small inline badge; default = larger card-style badge */
  size?: "sm" | "md";
  className?: string;
}

const TIER_ICONS: Record<ReputationTier, React.ReactNode> = {
  elite: <Star className="h-4 w-4" />,
  good: <ShieldCheck className="h-4 w-4" />,
  average: <Shield className="h-4 w-4" />,
  poor: <ShieldAlert className="h-4 w-4" />,
};

const TIER_ICONS_SM: Record<ReputationTier, React.ReactNode> = {
  elite: <Star className="h-3 w-3" />,
  good: <ShieldCheck className="h-3 w-3" />,
  average: <Shield className="h-3 w-3" />,
  poor: <ShieldAlert className="h-3 w-3" />,
};

export function ReputationBadge({
  tier,
  score,
  size = "md",
  className,
}: ReputationBadgeProps) {
  const config = TIER_CONFIG[tier];

  if (size === "sm") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border",
          config.bgColor,
          config.color,
          className
        )}
        title={`Reputation: ${config.label} (${score} points)`}
        aria-label={`Reputation tier: ${config.label}`}
      >
        {TIER_ICONS_SM[tier]}
        {config.label}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border font-medium text-sm",
        config.bgColor,
        config.color,
        className
      )}
      aria-label={`Reputation tier: ${config.label}`}
    >
      {TIER_ICONS[tier]}
      <span>{config.label}</span>
      <span className="opacity-70 text-xs font-normal">{score} pts</span>
    </div>
  );
}
