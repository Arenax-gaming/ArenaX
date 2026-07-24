"use client";

import React, { useState } from "react";
import { AlertTriangle, RefreshCw, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useError } from "@/components/providers/ErrorProvider";
import { ErrorCategory, ErrorSeverity } from "@/lib/errors";
import { LoggedError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ─── Severity badge ───────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<ErrorSeverity, string> = {
  [ErrorSeverity.LOW]: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  [ErrorSeverity.MEDIUM]: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  [ErrorSeverity.HIGH]: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  [ErrorSeverity.CRITICAL]: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  [ErrorCategory.NETWORK]: "Network",
  [ErrorCategory.AUTHENTICATION]: "Auth",
  [ErrorCategory.VALIDATION]: "Validation",
  [ErrorCategory.API]: "API",
  [ErrorCategory.RUNTIME]: "Runtime",
  [ErrorCategory.UNKNOWN]: "Unknown",
};

// ─── Individual error row ─────────────────────────────────────────────────────

function ErrorRow({ entry }: { entry: LoggedError }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-md overflow-hidden text-left">
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/50 transition-colors text-left"
        aria-expanded={expanded}
      >
        {/* Severity badge */}
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
            SEVERITY_STYLES[entry.severity],
          )}
        >
          {entry.severity}
        </span>

        {/* Category */}
        <span className="shrink-0 text-xs text-muted-foreground w-20">
          {CATEGORY_LABELS[entry.category]}
        </span>

        {/* Message */}
        <span className="flex-1 text-sm text-foreground truncate">{entry.message}</span>

        {/* Timestamp */}
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDistanceToNow(entry.timestamp, { addSuffix: true })}
        </span>

        {/* Recovery badge */}
        {entry.recovered && (
          <span className="shrink-0 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-2 py-0.5 text-xs font-medium">
            Recovered
          </span>
        )}

        {expanded ? (
          <ChevronUp className="shrink-0 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronDown className="shrink-0 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        )}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 py-3 bg-muted/30 border-t border-border space-y-2">
          <p className="text-xs text-muted-foreground">
            <strong>ID:</strong> {entry.id}
          </p>
          <p className="text-xs text-muted-foreground">
            <strong>Timestamp:</strong> {new Date(entry.timestamp).toISOString()}
          </p>
          {entry.recoveryAttempts !== undefined && entry.recoveryAttempts > 0 && (
            <p className="text-xs text-muted-foreground">
              <strong>Recovery attempts:</strong> {entry.recoveryAttempts}
            </p>
          )}
          {entry.stack && (
            <pre className="text-xs bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {entry.stack}
            </pre>
          )}
          {entry.metadata && (
            <pre className="text-xs bg-muted rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 text-center",
        highlight && value > 0 ? "border-destructive/40 bg-destructive/5" : "border-border bg-card",
      )}
    >
      <p className={cn("text-2xl font-bold", highlight && value > 0 ? "text-destructive" : "text-foreground")}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

/**
 * `ErrorMonitorDashboard` — read-only developer/admin view of all errors
 * captured by `errorLogger` in the current session.
 *
 * Renders summary counts, per-category breakdowns, and an expandable list of
 * individual error entries with stack traces and metadata.
 *
 * Intended for use in `/analytics` or an admin panel page — not shown to
 * end-users in production.
 */
export function ErrorMonitorDashboard() {
  const { errors, summary, clearErrors, refreshSummary } = useError();

  const [filterCategory, setFilterCategory] = useState<ErrorCategory | "all">("all");
  const [filterSeverity, setFilterSeverity] = useState<ErrorSeverity | "all">("all");

  const filtered = errors.filter((e) => {
    if (filterCategory !== "all" && e.category !== filterCategory) return false;
    if (filterSeverity !== "all" && e.severity !== filterSeverity) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-foreground">Error Monitor</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {summary.total} total
          </span>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={refreshSummary}
            aria-label="Refresh error summary"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={clearErrors}
            aria-label="Clear all logged errors"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total Errors" value={summary.total} />
        <SummaryCard label="Last 60 s" value={summary.recentCount} highlight />
        <SummaryCard label="Critical / High" value={(summary.bySeverity[ErrorSeverity.CRITICAL] ?? 0) + (summary.bySeverity[ErrorSeverity.HIGH] ?? 0)} highlight />
        <SummaryCard label="Recovered" value={summary.recoveredCount} />
      </div>

      {/* Category breakdown */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {Object.values(ErrorCategory).map((cat) => (
          <div
            key={cat}
            className="rounded-md border border-border bg-card px-3 py-2 text-center"
          >
            <p className="text-lg font-semibold text-foreground">
              {summary.byCategory[cat] ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[cat]}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="filter-category" className="text-xs text-muted-foreground">
            Category
          </label>
          <select
            id="filter-category"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value as ErrorCategory | "all")}
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All</option>
            {Object.values(ErrorCategory).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="filter-severity" className="text-xs text-muted-foreground">
            Severity
          </label>
          <select
            id="filter-severity"
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value as ErrorSeverity | "all")}
            className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">All</option>
            {Object.values(ErrorSeverity).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {(filterCategory !== "all" || filterSeverity !== "all") && (
          <button
            type="button"
            onClick={() => { setFilterCategory("all"); setFilterSeverity("all"); }}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Error list */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {errors.length === 0 ? "No errors logged yet." : "No errors match the current filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <ErrorRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
