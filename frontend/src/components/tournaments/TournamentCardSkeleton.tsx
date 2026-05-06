import React from "react";
import { Card } from "@/components/ui/Card";

export function TournamentCardSkeleton() {
  return (
    <Card className="flex flex-col overflow-hidden">
      {/* Header with Status */}
      <div className="flex items-start justify-between border-b p-4">
        <div className="flex-1 space-y-2">
          {/* Title skeleton */}
          <div className="h-6 w-3/4 animate-pulse rounded bg-muted" />
          {/* Game type skeleton */}
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
        {/* Status badge skeleton */}
        <div className="ml-2 h-6 w-20 animate-pulse rounded-full bg-muted" />
      </div>

      {/* Details */}
      <div className="flex-1 p-4 space-y-3">
        {/* Description skeleton */}
        <div className="space-y-2">
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          {/* Entry Fee */}
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-pulse rounded bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-12 animate-pulse rounded bg-muted" />
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            </div>
          </div>

          {/* Prize Pool */}
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-pulse rounded bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-14 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
          </div>

          {/* Start Time */}
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-pulse rounded bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-10 animate-pulse rounded bg-muted" />
              <div className="h-4 w-16 animate-pulse rounded bg-muted" />
            </div>
          </div>

          {/* Participants */}
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-pulse rounded bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-12 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="pt-2 space-y-2">
          <div className="flex justify-between">
            <div className="h-3 w-10 animate-pulse rounded bg-muted" />
            <div className="h-3 w-8 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-2 w-full animate-pulse rounded-full bg-muted" />
        </div>
      </div>

      {/* Footer with Button */}
      <div className="border-t p-4">
        <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
      </div>
    </Card>
  );
}
