/**
 * PageSkeleton — reusable skeleton building blocks.
 *
 * Provides a base `Skeleton` pulse block plus higher-level
 * composites used by loading.tsx files and inline loaders.
 *
 * Accessibility: all skeleton wrappers carry aria-hidden="true" so
 * screen readers skip decorative placeholders. Where a live region is
 * needed the caller should pair this with an sr-only "Loading…" text.
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

// ---------------------------------------------------------------------------
// Avatar skeleton — circular or rounded-square user avatar placeholder
// ---------------------------------------------------------------------------

export function AvatarSkeleton({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const sizeMap = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-14 w-14",
    xl: "h-20 w-20",
  };
  return (
    <Skeleton
      className={cn("rounded-full shrink-0", sizeMap[size], className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Badge skeleton — inline pill placeholder
// ---------------------------------------------------------------------------

export function BadgeSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton className={cn("h-5 w-16 rounded-full", className)} />
  );
}

// ---------------------------------------------------------------------------
// Friend / user row skeleton — avatar + name + status + action
// ---------------------------------------------------------------------------

export function UserRowSkeleton({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 py-2 border-b last:border-0"
        >
          <div className="flex items-center gap-3">
            <AvatarSkeleton size="md" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <BadgeSkeleton />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification row skeleton — icon + text + timestamp
// ---------------------------------------------------------------------------

export function NotificationRowSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn("divide-y divide-border/50", className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 p-4">
          <Skeleton className="h-8 w-8 rounded-full shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-14 shrink-0" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Messages panel skeleton — conversation list + chat area
// ---------------------------------------------------------------------------

export function MessagesPanelSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px]", className)}
      aria-hidden="true"
    >
      {/* Conversation list */}
      <div className="rounded-lg border bg-card overflow-hidden flex flex-col">
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-32" />
        </div>
        <div className="flex-1 divide-y divide-border/50 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4">
              <AvatarSkeleton size="md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat area */}
      <div className="md:col-span-2 rounded-lg border bg-card overflow-hidden flex flex-col">
        <div className="p-4 border-b">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={cn("flex gap-3", i % 2 === 1 && "flex-row-reverse")}
            >
              <AvatarSkeleton size="sm" />
              <Skeleton
                className={cn(
                  "h-12 rounded-2xl",
                  i % 2 === 1 ? "w-48" : "w-64",
                )}
              />
            </div>
          ))}
        </div>
        <div className="p-4 border-t">
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Achievement card skeleton
// ---------------------------------------------------------------------------

export function AchievementCardSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn("p-4", className)} aria-hidden="true">
      <div className="flex items-start gap-3">
        <Skeleton className="h-12 w-12 rounded-xl shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-4 w-32" />
            <BadgeSkeleton />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          {/* Progress bar */}
          <div className="space-y-1 pt-1">
            <div className="flex justify-between">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-2.5 w-10" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Settings page skeleton — sidebar nav + form content
// ---------------------------------------------------------------------------

export function SettingsPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("min-h-screen bg-background", className)} aria-hidden="true">
      {/* Header bar */}
      <div className="border-b bg-card px-4 sm:px-8 py-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar nav */}
          <div className="lg:col-span-1 space-y-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-lg">
                <Skeleton className="h-5 w-5 shrink-0" />
                <div className="space-y-1">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-2.5 w-28" />
                </div>
              </div>
            ))}
          </div>

          {/* Main form area */}
          <div className="lg:col-span-3 space-y-6">
            <CardSkeleton lines={4} hasFooter />
            <CardSkeleton lines={3} />
            <CardSkeleton lines={4} hasFooter />
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tournament detail skeleton — hero + sidebar
// ---------------------------------------------------------------------------

export function TournamentDetailSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("min-h-screen bg-background px-4 py-8", className)} aria-hidden="true">
      {/* Back button */}
      <Skeleton className="h-8 w-16 rounded-md mb-6" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-8 lg:col-span-2">
          {/* Hero banner */}
          <div className="rounded-[32px] border overflow-hidden">
            <Skeleton className="h-48 w-full rounded-none" />
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-2">
                  <Skeleton className="h-8 w-64" />
                  <Skeleton className="h-4 w-40" />
                </div>
                <BadgeSkeleton className="w-24 h-7" />
              </div>
              {/* Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Rules card */}
          <CardSkeleton lines={5} />

          {/* Participants card */}
          <div className="rounded-[32px] border bg-card p-6 space-y-4">
            <Skeleton className="h-5 w-32" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl border">
                  <AvatarSkeleton size="sm" />
                  <Skeleton className="h-4 w-28" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Join button card */}
          <div className="rounded-[32px] border bg-card p-6 space-y-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-12 w-full rounded-full" />
          </div>

          {/* Quick stats */}
          <div className="rounded-[32px] border bg-card p-6 space-y-4">
            <Skeleton className="h-5 w-28" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b pb-3 last:border-0"
              >
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Play / game mode selector skeleton
// ---------------------------------------------------------------------------

export function PlayPageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "min-h-screen px-4 py-8 bg-gradient-to-br from-gray-900 via-purple-900/50 to-gray-900",
        className,
      )}
      aria-hidden="true"
    >
      <div className="container mx-auto space-y-12">
        {/* Hero heading */}
        <div className="text-center space-y-3">
          <Skeleton className="h-12 w-72 mx-auto" />
          <Skeleton className="h-5 w-64 mx-auto" />
        </div>

        {/* Game mode cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border bg-white/10 backdrop-blur p-6 space-y-3"
            >
              <Skeleton className="h-12 w-12 rounded-xl" />
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-10 w-full rounded-lg mt-2" />
            </div>
          ))}
        </div>

        {/* Info cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border bg-white/10 backdrop-blur p-6 space-y-2"
            >
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Party page skeleton
// ---------------------------------------------------------------------------

export function PartyPageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("min-h-screen px-4 py-8", className)} aria-hidden="true">
      <div className="container mx-auto space-y-8">
        <PageHeaderSkeleton />

        {/* Create party button */}
        <Skeleton className="h-12 w-40 rounded-lg" />

        {/* Party cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border bg-card p-6 space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1.5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3.5 w-56" />
                </div>
                <BadgeSkeleton />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
                <div className="space-y-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-12" />
                </div>
              </div>
              <UserRowSkeleton count={3} />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
