/**
 * Shared chart theme helpers that map ArenaX CSS design tokens to Recharts props.
 * All colours use `hsl(var(--token))` so they automatically follow light/dark mode.
 */

export const CHART_COLORS = {
  primary: "hsl(var(--primary))",
  success: "hsl(var(--success))",
  destructive: "hsl(var(--destructive))",
  warning: "hsl(var(--warning))",
  muted: "hsl(var(--muted-foreground))",
  border: "hsl(var(--border))",
  card: "hsl(var(--card))",
  foreground: "hsl(var(--foreground))",
} as const;

/** Ordered palette for multi-series charts */
export const SERIES_COLORS = [
  CHART_COLORS.primary,
  CHART_COLORS.success,
  CHART_COLORS.warning,
  CHART_COLORS.destructive,
];

export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: CHART_COLORS.card,
    border: `1px solid ${CHART_COLORS.border}`,
    borderRadius: "var(--radius)",
    fontSize: 12,
  },
  labelStyle: { color: CHART_COLORS.foreground, fontWeight: 600 },
  itemStyle: { color: CHART_COLORS.foreground },
  cursor: { fill: "hsl(var(--muted) / 0.4)" },
};

export const AXIS_PROPS = {
  stroke: CHART_COLORS.muted,
  fontSize: 12,
  tickLine: false,
  axisLine: false,
};

export const GRID_PROPS = {
  strokeDasharray: "3 3",
  vertical: false,
  stroke: "hsl(var(--muted-foreground) / 0.2)",
};
