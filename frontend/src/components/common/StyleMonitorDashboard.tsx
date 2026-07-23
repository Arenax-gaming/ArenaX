"use client";

import React, { useState } from "react";
import { Palette, RefreshCw, Trash2, Monitor } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useResponsive } from "@/hooks/useResponsive";
import {
  getStyleEvents,
  getStyleSummary,
  clearStyleEvents,
  StyleAnalyticsEntry,
  StyleEventType,
  BREAKPOINTS,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ─── Event colours ────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<StyleEventType, string> = {
  theme_changed: "Theme",
  accent_changed: "Accent",
  compact_mode: "Compact",
  animations_toggled: "Animations",
  responsive_breakpoint: "Breakpoint",
};

const EVENT_COLOURS: Record<StyleEventType, string> = {
  theme_changed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  accent_changed: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  compact_mode: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  animations_toggled: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  responsive_breakpoint: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
};

// ─── Token preview ────────────────────────────────────────────────────────────

const TOKEN_SWATCHES = [
  { label: "Background",   cssVar: "--background" },
  { label: "Foreground",   cssVar: "--foreground" },
  { label: "Primary",      cssVar: "--primary" },
  { label: "Muted",        cssVar: "--muted" },
  { label: "Destructive",  cssVar: "--destructive" },
  { label: "Success",      cssVar: "--success" },
  { label: "Warning",      cssVar: "--warning" },
  { label: "Border",       cssVar: "--border" },
];

function TokenSwatch({ label, cssVar }: { label: string; cssVar: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-6 w-6 rounded border border-border shrink-0"
        style={{ backgroundColor: `hsl(var(${cssVar}))` }}
        aria-label={`${label} colour swatch`}
      />
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground font-mono">{cssVar}</p>
      </div>
    </div>
  );
}

// ─── Breakpoint ruler ─────────────────────────────────────────────────────────

function BreakpointRuler() {
  const { width, breakpoint } = useResponsive();
  const bps = Object.entries(BREAKPOINTS) as [string, number][];

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Viewport: <strong className="text-foreground">{width}px</strong>
        {" — "}
        Active breakpoint: <strong className="text-primary">{breakpoint}</strong>
      </p>
      <div className="relative h-4 rounded overflow-hidden bg-muted">
        {bps.map(([name, px]) => (
          <div
            key={name}
            className={cn(
              "absolute top-0 h-full border-l border-border",
              "flex items-center pl-1",
            )}
            style={{ left: `${Math.min((px / 1400) * 100, 99)}%` }}
            title={`${name}: ${px}px`}
          />
        ))}
        {/* Current width indicator */}
        <div
          className="absolute top-0 h-full w-0.5 bg-primary"
          style={{ left: `${Math.min((width / 1400) * 100, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        {bps.map(([name, px]) => (
          <span key={name} className={cn(name === breakpoint && "text-primary font-medium")}>
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Event row ────────────────────────────────────────────────────────────────

function EventRow({ entry }: { entry: StyleAnalyticsEntry }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5">
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", EVENT_COLOURS[entry.type])}>
        {EVENT_LABELS[entry.type]}
      </span>
      {entry.detail && (
        <span className="flex-1 truncate text-sm text-foreground font-mono">{entry.detail}</span>
      )}
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatDistanceToNow(entry.timestamp, { addSuffix: true })}
      </span>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * `StyleMonitorDashboard` — developer/admin view of style system state.
 *
 * Shows:
 * - Live design token colour swatches
 * - Responsive breakpoint ruler
 * - Style analytics event log
 *
 * Guard with admin role check before rendering in production.
 */
export function StyleMonitorDashboard() {
  const [events, setEvents] = useState<StyleAnalyticsEntry[]>(() => getStyleEvents());
  const [filter, setFilter] = useState<StyleEventType | "all">("all");
  const summary = getStyleSummary();

  const handleRefresh = () => setEvents(getStyleEvents());
  const handleClear = () => { clearStyleEvents(); setEvents([]); };

  const filtered = filter === "all" ? events : events.filter((e) => e.type === filter);

  return (
    <div className="space-y-6" role="region" aria-label="Style monitor">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-foreground">Style Monitor</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {events.length} events
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleRefresh} aria-label="Refresh style events">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button size="sm" variant="ghost" onClick={handleClear} aria-label="Clear style events">
            <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>

      {/* Design token swatches */}
      <div>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">Active Design Tokens</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TOKEN_SWATCHES.map((t) => (
            <TokenSwatch key={t.cssVar} label={t.label} cssVar={t.cssVar} />
          ))}
        </div>
      </div>

      {/* Responsive ruler */}
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Monitor className="h-4 w-4" aria-hidden="true" />
          Responsive Breakpoints
        </h3>
        <BreakpointRuler />
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(Object.keys(EVENT_LABELS) as StyleEventType[]).map((t) => (
          <div key={t} className="rounded-lg border border-border bg-card p-3 text-center">
            <p className="text-xl font-bold text-foreground">{summary[t] ?? 0}</p>
            <p className="text-xs text-muted-foreground">{EVENT_LABELS[t]}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <label htmlFor="style-filter" className="text-xs text-muted-foreground">Filter</label>
        <select
          id="style-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as StyleEventType | "all")}
          className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">All</option>
          {(Object.keys(EVENT_LABELS) as StyleEventType[]).map((t) => (
            <option key={t} value={t}>{EVENT_LABELS[t]}</option>
          ))}
        </select>
        {filter !== "all" && (
          <button type="button" onClick={() => setFilter("all")} className="text-xs text-muted-foreground underline underline-offset-2">
            Clear
          </button>
        )}
      </div>

      {/* Event list */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {events.length === 0 ? "No style events recorded yet." : "No events match the current filter."}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((entry, i) => (
            <EventRow key={`${entry.type}-${entry.timestamp}-${i}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
