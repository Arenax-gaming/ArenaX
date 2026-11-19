"use client";

import { useEffect, useState } from "react";
import { useAnalytics } from "@/hooks/useAnalytics";

// ---------------------------------------------------------------------------
// Match debug overlay (#1566)
//
// Shows end-to-end WebSocket round-trip latency (not just server ping) so
// players/QA can see what the client actually experiences. Only renders
// when a debug flag is enabled, and logs latency samples to analytics on
// an independent 10s interval.
// ---------------------------------------------------------------------------

/** How often latency samples are reported to analytics. */
const ANALYTICS_REPORT_INTERVAL_MS = 10_000;

const LATENCY_THRESHOLD_GOOD_MS = 60;
const LATENCY_THRESHOLD_WARN_MS = 120;

type LatencyLevel = "good" | "warn" | "bad" | "unknown";

function getLatencyLevel(latencyMs: number | null): LatencyLevel {
  if (latencyMs === null) return "unknown";
  if (latencyMs < LATENCY_THRESHOLD_GOOD_MS) return "good";
  if (latencyMs <= LATENCY_THRESHOLD_WARN_MS) return "warn";
  return "bad";
}

const LEVEL_COLORS: Record<LatencyLevel, string> = {
  good: "#22c55e", // green
  warn: "#eab308", // yellow
  bad: "#ef4444", // red
  unknown: "#9ca3af", // gray
};

/**
 * Debug mode is opt-in through any of:
 *  - `?debug=1` (or `debug=true`) query param
 *  - `localStorage["arenax:debug-overlay"] === "true"` (sticky toggle)
 *  - `NEXT_PUBLIC_ENABLE_DEBUG_OVERLAY=true` build-time default
 */
function isDebugOverlayEnabled(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const param = new URLSearchParams(window.location.search).get("debug");
    if (param === "1" || param === "true") return true;
  } catch {
    // ignore malformed URL
  }

  try {
    if (window.localStorage.getItem("arenax:debug-overlay") === "true") return true;
  } catch {
    // ignore storage access errors (e.g. privacy mode)
  }

  return process.env.NEXT_PUBLIC_ENABLE_DEBUG_OVERLAY === "true";
}

export interface MatchDebugOverlayProps {
  matchId: string;
  isConnected: boolean;
  /** Rolling average (ms) of the last up to 10 round-trip samples. */
  latencyMs: number | null;
  /** Raw samples backing `latencyMs`, used only for the sample count shown. */
  latencySamples: number[];
}

export function MatchDebugOverlay({
  matchId,
  isConnected,
  latencyMs,
  latencySamples,
}: MatchDebugOverlayProps) {
  const { track } = useAnalytics();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(isDebugOverlayEnabled());
  }, []);

  // Report the rolling average to analytics every 10s, independent of how
  // often new samples arrive.
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      if (latencySamples.length === 0 || latencyMs === null) return;
      track("match_latency_sample", {
        matchId,
        avgLatencyMs: latencyMs,
        sampleCount: latencySamples.length,
      });
    }, ANALYTICS_REPORT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, matchId, latencyMs, latencySamples, track]);

  if (!enabled) return null;

  const level = getLatencyLevel(latencyMs);

  return (
    <div
      data-testid="match-debug-overlay"
      role="status"
      aria-label="Match debug overlay"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        minWidth: 160,
        padding: "10px 14px",
        borderRadius: 10,
        background: "rgba(15, 23, 42, 0.88)",
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        lineHeight: 1.6,
        boxShadow: "0 10px 30px -15px rgba(0,0,0,0.6)",
        pointerEvents: "none",
      }}
    >
      <div style={{ opacity: 0.7, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
        Debug Overlay
      </div>
      <div>{isConnected ? "WS: connected" : "WS: disconnected"}</div>
      <div>
        Latency:{" "}
        <span style={{ color: LEVEL_COLORS[level], fontWeight: 600 }}>
          {latencyMs !== null ? `${latencyMs}ms` : "measuring..."}
        </span>
        {latencySamples.length > 0 && (
          <span style={{ opacity: 0.6 }}> ({latencySamples.length}/10)</span>
        )}
      </div>
    </div>
  );
}

export default MatchDebugOverlay;
