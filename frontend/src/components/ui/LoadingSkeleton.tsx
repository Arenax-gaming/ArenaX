"use client";

/**
 * LoadingSkeleton — Issue #829
 *
 * Skeleton components for smooth loading states during infinite scroll.
 */

import React from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted",
        className
      )}
      aria-busy="true"
      aria-label="Loading"
    />
  );
}

export interface ListItemSkeletonProps {
  height?: number;
  className?: string;
}

export function ListItemSkeleton({ height = 64, className }: ListItemSkeletonProps) {
  return (
    <div
      className={cn("flex items-center gap-4 p-4 border-b", className)}
      style={{ height }}
    >
      {/* Avatar/Icon */}
      <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
      
      {/* Content */}
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      
      {/* Action */}
      <Skeleton className="h-8 w-20 flex-shrink-0" />
    </div>
  );
}

export interface CardSkeletonProps {
  height?: number;
  className?: string;
}

export function CardSkeleton({ height = 300, className }: CardSkeletonProps) {
  return (
    <div
      className={cn("rounded-lg border bg-card p-4 space-y-4", className)}
      style={{ height }}
    >
      {/* Header image */}
      <Skeleton className="h-32 w-full rounded-md" />
      
      {/* Title */}
      <Skeleton className="h-6 w-3/4" />
      
      {/* Description lines */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/6" />
      </div>
      
      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  );
}

export interface LeaderboardSkeletonProps {
  rows?: number;
  className?: string;
}

export function LeaderboardSkeleton({ rows = 5, className }: LeaderboardSkeletonProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 p-3 rounded-lg border">
          {/* Rank */}
          <Skeleton className="h-8 w-8 rounded flex-shrink-0" />
          
          {/* Avatar */}
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
          
          {/* Name & Info */}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
          
          {/* Stats */}
          <div className="flex gap-4">
            <div className="space-y-1">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface MatchHistorySkeletonProps {
  rows?: number;
  className?: string;
}

export function MatchHistorySkeleton({ rows = 3, className }: MatchHistorySkeletonProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
          
          {/* Players */}
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-12 ml-auto" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-6 w-12 ml-auto" />
            </div>
          </div>
          
          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-6 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface TournamentGridSkeletonProps {
  columns?: number;
  rows?: number;
  className?: string;
}

export function TournamentGridSkeleton({
  columns = 3,
  rows = 2,
  className,
}: TournamentGridSkeletonProps) {
  const totalCards = columns * rows;
  
  return (
    <div
      className={cn(
        "grid gap-6",
        className
      )}
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: totalCards }, (_, i) => (
        <CardSkeleton key={i} height={340} />
      ))}
    </div>
  );
}

// Generic skeleton list for virtualized lists
export interface VirtualListSkeletonProps {
  itemHeight: number;
  visibleItems: number;
  renderSkeleton?: () => React.ReactNode;
  className?: string;
}

export function VirtualListSkeleton({
  itemHeight,
  visibleItems,
  renderSkeleton,
  className,
}: VirtualListSkeletonProps) {
  return (
    <div className={cn("space-y-0", className)}>
      {Array.from({ length: visibleItems }, (_, i) => (
        <div key={i} style={{ height: itemHeight }}>
          {renderSkeleton ? renderSkeleton() : <ListItemSkeleton height={itemHeight} />}
        </div>
      ))}
    </div>
  );
}
