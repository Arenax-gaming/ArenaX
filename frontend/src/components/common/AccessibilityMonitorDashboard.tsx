"use client";

import React, { useState } from "react";
import { Eye, Keyboard, Volume2, AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAccessibility } from "@/components/providers/AccessibilityProvider";
import { a11yAnalytics, A11yEventType } from "@/lib/accessibility";
import { A11yAnalyticsEntry } from "@/lib/accessibility";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ─── Event type labels / colours ──────────────────────────────────────────────

const EVENT_LABELS: Record<A11yEventType, string> = {
  keyboard_nav: "Keyboard Nav",
  skip_link_used: "Skip Link",
  focus_trap_activated: "Focus Trap",
  screen_reader_announced: "SR Announced",
  shortcut_used: "Shortcut",
  reduced_motion_detected: "Reduced Motion",
  high_contrast_detected: "High Contrast",
  violation_detected: "Violation",
};

const EVENT_COLOURS: Record<A11yEventType, string> = {
  keyboard_nav: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  skip_link_used: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  focus_trap_activated: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  screen_reader_announced: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  shortcut_used: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  reduced_motion_detected: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  high_contrast_detected: "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  violation_detected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

// ─── Preference indicator ─────────────────────────────────────────────────────

function PrefBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground",
      )}
      aria-label={`${label}: ${active ? "active" : "inactive"}`}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          active ? "bg-primary" : "bg-muted-foreground/40",
        )}
        aria-hidden="true"
      />
      {label}
    </div>
  );
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-center">
      <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center text-muted-foreground">
        {icon}
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ entry }: { entry: A11yAnalyticsEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5">
      <span
        className={cn(
          "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
          EVENT_COLOURS[entry.type],
        )}
      >
        {EVENT_LABELS[entry.type]}
      </span>

      {entry.detail && (
        <span className="flex-1 truncate text-sm text-foreground">{entry.detail}</span>
      )}

      <span className="shrink-0 text-xs text-muted-foreground">
        {formatDistanceToNow(entry.timestamp, { addSuffix: true })}
      </span>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * `AccessibilityMonitorDashboard` — developer/admin view of all
 * accessibility events tracked in the current session.
 *
 * Shows:
 * - Current OS-level preferences (reduced motion, high contrast, keyboard user)
 * - Per-event-type counts
 * - Chronological event list filterable by type
 *
 * Guard this component behind an admin/role check in production.
 */
export function AccessibilityMonitorDashboard() {
  const { preferences, a11yEvents } = useAccessibility();
  const [filter, setFilter] = useState<A11yEventType | "all">("all");
  const [events, setEvents] = useState<A11yAnalyticsEntry[]>(() => a11yAnalytics.getEvents());

  const summary = a11yAnalytics.getSummary();

  const handleRefresh = () => setEvents(a11yAnalytics.getEvents());

  const handleClear = () => {
    a11yAnalytics.clear();
    setEvents([]);
  };

  const filtered =
    filter === "all" ? events : events.filter((e) => e.type === filter);

  return (
    <div className="space-y-6" role="region" aria-label="Accessibility monitor">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-foreground">Accessibility Monitor</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {events.length} events
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleRefresh} aria-label="Refresh event list">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClear} aria-label="Clear all accessibility events">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>

      {/* OS preferences */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Detected Preferences</h3>
        <div className="flex flex-wrap gap-2">
          <PrefBadge label="Reduced Motion" active={preferences.prefersReducedMotion} />
          <PrefBadge label="High Contrast" active={preferences.prefersHighContrast} />
          <PrefBadge label="Keyboard User" active={preferences.isKeyboardUser} />
          <PrefBadge label="Screen Reader" active={preferences.screenReaderEnabled} />
        </div>
      </div>

      {/* Summary grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Keyboard Nav"
          value={summary.keyboard_nav ?? 0}
          icon={<Keyboard className="h-4 w-4" />}
        />
        <SummaryCard
          label="SR Announced"
          value={summary.screen_reader_announced ?? 0}
          icon={<Volume2 className="h-4 w-4" />}
        />
        <SummaryCard
          label="Skip Links"
          value={summary.skip_link_used ?? 0}
          icon={<Eye className="h-4 w-4" />}
        />
        <SummaryCard
          label="Violations"
          value={summary.violation_detected ?? 0}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <label htmlFor="a11y-filter" className="text-xs text-muted-foreground">
          Filter by type
        </label>
        <select
          id="a11y-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as A11yEventType | "all")}
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Filter accessibility events by type"
        >
          <option value="all">All</option>
          {(Object.keys(EVENT_LABELS) as A11yEventType[]).map((t) => (
            <option key={t} value={t}>
              {EVENT_LABELS[t]}
            </option>
          ))}
        </select>
        {filter !== "all" && (
          <button
            type="button"
            onClick={() => setFilter("all")}
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear filter
          </button>
        )}
      </div>

      {/* Event list */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {events.length === 0
              ? "No accessibility events recorded yet."
              : "No events match the current filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5" role="list" aria-label="Accessibility events">
          {filtered.map((entry, i) => (
            <div key={`${entry.type}-${entry.timestamp}-${i}`} role="listitem">
              <EventRow entry={entry} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
