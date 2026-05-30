/**
 * PageSkeleton — reusable skeleton building blocks.
 *
 * Provides a base `Skeleton` pulse block plus higher-level
 * composites used by loading.tsx files and inline loaders.
 */
import React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";

// ---------------------------------------------------------------------------
// Primitive
// ---------------------------------------------------------------------------

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      aria-hidden="true"
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Card skeleton — generic card with a header + body lines
// ---------------------------------------------------------------------------

interface CardSkeletonProps {
  lines?: number;
  className?: string;
  hasFooter?: boolean;
}

export function CardSkeleton({
  lines = 3,
  className,
  hasFooter = false,
}: CardSkeletonProps) {
  return (
    <Card className={cn("overflow-hidden", className)} aria-hidden="true">
      <CardHeader className="space-y-2 pb-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn("h-4", i === lines - 1 ? "w-3/4" : "w-full")}
          />
        ))}
        {hasFooter && (
          <div className="pt-2">
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Table skeleton — header row + N body rows
// ---------------------------------------------------------------------------

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  className?: string;
}

export function TableSkeleton({
  rows = 5,
  cols = 5,
  className,
}: TableSkeletonProps) {
  return (
    <div
      className={cn("overflow-x-auto rounded-xl border border-border", className)}
      aria-hidden="true"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="px-4 py-3">
                <Skeleton className="h-3 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b">
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c} className="px-4 py-3">
                  <Skeleton
                    className={cn(
                      "h-4",
                      c === 0 ? "w-8" : c === 1 ? "w-28" : "w-16"
                    )}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page header skeleton
// ---------------------------------------------------------------------------

export function PageHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-hidden="true">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat card row skeleton (e.g. dashboard stats)
// ---------------------------------------------------------------------------

export function StatRowSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        count === 3 && "grid-cols-1 sm:grid-cols-3",
        count === 4 && "grid-cols-2 sm:grid-cols-4",
        count === 6 && "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
        className
      )}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-1 pt-4 px-4">
            <Skeleton className="h-3 w-20" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <Skeleton className="h-7 w-24" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// List item skeleton (e.g. dispute cards, KYC queue items)
// ---------------------------------------------------------------------------

export function ListItemSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("border-2", className)} aria-hidden="true">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-9 w-full rounded-md mt-2" />
      </CardContent>
    </Card>
  );
}
