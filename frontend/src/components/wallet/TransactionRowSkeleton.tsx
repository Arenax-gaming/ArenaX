"use client";

import { motion } from "framer-motion";
import { shimmer } from "@/components/animations";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { cn } from "@/lib/utils";

// Gradient sweep driven by the shared `shimmer` animation token.
const SHIMMER_BG =
  "bg-[linear-gradient(90deg,hsl(var(--muted))_25%,hsl(var(--muted-foreground)/0.15)_50%,hsl(var(--muted))_75%)] bg-[length:200%_100%]";

function Block({ className }: { className?: string }) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) {
    // Static placeholder for users who prefer reduced motion
    return <div className={cn("rounded bg-muted", className)} />;
  }
  return <motion.div className={cn("rounded", SHIMMER_BG, className)} {...shimmer} />;
}

/**
 * Placeholder matching the geometry of a transaction row in
 * `TransactionHistory` (direction/amount + status, date, hash) so swapping
 * in real data causes no layout shift.
 */
export function TransactionRowSkeleton() {
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm" aria-hidden="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Block className="h-5 w-5 rounded-full" />
          <Block className="h-5 w-40" />
        </div>
        <Block className="h-6 w-16 rounded-full" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Block className="h-4 w-36" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Block className="h-4 w-56" />
      </div>
    </div>
  );
}
