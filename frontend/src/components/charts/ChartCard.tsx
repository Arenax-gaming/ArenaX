/**
 * ChartCard — Card wrapper for chart sections.
 *
 * - Provides an accessible heading + optional description for screen readers.
 * - Wraps children in a fixed-height container so ResponsiveContainer works.
 *
 * Usage:
 *   <ChartCard title="Win Rate" description="Monthly win/loss ratio" height={300}>
 *     <ResponsiveContainer>...</ResponsiveContainer>
 *   </ChartCard>
 */
"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/Card";

interface ChartCardProps {
  title: string;
  description?: string;
  /** Height in px for the inner chart area. Defaults to 300. */
  height?: number;
  className?: string;
  children: React.ReactNode;
}

export function ChartCard({
  title,
  description,
  height = 300,
  className,
  children,
}: ChartCardProps) {
  const descId = `chart-desc-${title.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <Card className={className} aria-describedby={description ? descId : undefined}>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        {description && (
          <CardDescription id={descId}>{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {/* aria-hidden: the chart is visual; meaningful data is in the title/description */}
        <div style={{ height }} aria-hidden="true">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
