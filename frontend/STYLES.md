# ArenaX Frontend — Style Architecture

---

## Table of Contents

1. [Overview](#overview)
2. [Design Tokens](#design-tokens)
3. [CSS-in-JS Helpers](#css-in-js-helpers)
4. [Theme System](#theme-system)
5. [Responsive Utilities](#responsive-utilities)
6. [Utility Classes](#utility-classes)
7. [Hooks Reference](#hooks-reference)
8. [Style Analytics & Monitoring](#style-analytics--monitoring)
9. [Testing](#testing)
10. [Decision Log](#decision-log)

---

## Overview

The style system is built on three layers:

| Layer | Technology | File |
|-------|-----------|------|
| Design tokens | CSS custom properties in `@layer base` | `src/styles/globals.css` |
| CSS-in-JS utilities | Typed TypeScript helpers | `src/lib/theme.ts` |
| Responsive utilities | React hooks + breakpoint constants | `src/hooks/useResponsive.ts` |

No additional CSS-in-JS runtime (styled-components, emotion, etc.) is introduced — the approach uses **Tailwind + typed CSS variable helpers** to get type-safe style composition without any bundle overhead.

---

## Design Tokens

All design tokens are defined as CSS custom properties in `globals.css` and consumed via Tailwind's `hsl(var(--token))` pattern.

### Token categories

| Category | Example tokens |
|----------|---------------|
| Core palette | `--background`, `--foreground`, `--primary`, `--destructive` |
| Surface | `--surface`, `--surface-raised`, `--surface-overlay` |
| Status | `--success`, `--warning`, `--info` (with `-foreground`, `-muted` variants) |
| Typography | `--font-size-*`, `--line-height-*` |
| Spacing | `--space-1` … `--space-16` |
| Elevation | `--shadow-sm` … `--shadow-xl`, `--shadow-glow` |
| Motion | `--duration-*`, `--ease-*` |
| Z-index | `--z-below` … `--z-tooltip` |

### Dark mode

Tokens are overridden inside `.dark { }` in globals.css. `next-themes` toggles the `dark` class on `<html>`.

### Accent colour overrides

Six accent colours are supported: `blue` (default), `purple`, `green`, `orange`, `red`, `pink`.

Applied via `data-accent` attribute on `<html>`:

```css
[data-accent="purple"] { --primary: 270 91% 65%; --ring: 270 91% 65%; }
```

Use `applyAccentColor(color)` from `lib/theme.ts` to set this at runtime.

### High-contrast overrides

`html.high-contrast` tightens border contrast and saturates the primary colour. Applied by `AccessibilityProvider` when `prefers-contrast: more` is detected.

### Compact mode

`html.compact` reduces `--space-4`, `--space-6`, `--space-8` and sets `font-size: 14px`. Applied by `applyCompactMode(true)`.

### Reduced motion

`html.reduce-motion` sets all animation and transition durations to `0.01ms`. Applied by `applyAnimationsEnabled(false)` and by `AccessibilityProvider` when `prefers-reduced-motion: reduce` is detected.

---

## CSS-in-JS Helpers

All helpers live in `src/lib/theme.ts` and have **zero runtime cost** — they are pure TypeScript that returns strings or plain objects.

### `token(t: DesignToken): string`

Returns `var(--token)` for use in `style` props.

```ts
import { token } from "@/lib/theme";

<div style={{ color: token("--primary") }} />
// → style={{ color: "var(--primary)" }}
```

### `css(styles): React.CSSProperties`

Typed wrapper around a plain style object. Provides autocomplete for CSS properties and token values.

```ts
const cardStyle = css({
  padding: token("--space-4"),
  borderRadius: token("--radius"),
  boxShadow: token("--shadow-md"),
});
```

### `cssmerge(...styles): React.CSSProperties`

Merges multiple `css()` objects. Later arguments win on conflict. Ignores falsy entries.

```ts
const base = css({ padding: "1rem", color: "red" });
const override = css({ color: "blue" });
const merged = cssmerge(base, override, isActive && css({ fontWeight: "bold" }));
// → { padding: "1rem", color: "blue", fontWeight: "bold" }
```

### `responsive(values): string`

Returns the value that matches the current viewport breakpoint, falling back to smaller breakpoints or `base`.

```ts
const padding = responsive({ base: "1rem", md: "2rem", lg: "3rem" });
// On a 1024px viewport → "3rem"
```

### `getTokenValue(t): string`

Reads the resolved value of a CSS variable at runtime. Use only client-side.

```ts
const primaryHsl = getTokenValue("--primary"); // e.g. "217 91% 60%"
```

---

## Theme System

### `useThemeConfig` hook

```ts
const {
  applySettings,       // Apply a full ThemeSettings object
  setMode,             // Change light | dark | system
  setAccentColor,      // Change accent colour
  setCompactMode,      // Toggle compact layout
  setAnimationsEnabled,// Toggle animations
  activeAccent,        // Current accent from DOM
} = useThemeConfig();
```

`applySettings` is the primary entry point — call it when the user saves their theme settings:

```tsx
const { applySettings } = useThemeConfig();

const handleSave = (settings: ThemeSettings) => {
  applySettings(settings);
  api.saveSettings({ theme: settings });
};
```

### Accent colour persistence

`useThemeConfig` reads `localStorage.getItem("arenax_accent")` on mount to restore the accent colour between page loads. Write `localStorage.setItem("arenax_accent", color)` when the user saves their settings.

### CSS classes applied to `<html>`

| Condition | Class |
|-----------|-------|
| Dark mode | `dark` (managed by next-themes) |
| Compact mode | `compact` |
| Animations disabled | `reduce-motion` |
| High contrast (OS) | `high-contrast` (AccessibilityProvider) |
| Keyboard user | `keyboard-user` (AccessibilityProvider) |

---

## Responsive Utilities

### `useResponsive` hook

```tsx
const {
  breakpoint,  // "xs" | "sm" | "md" | "lg" | "xl" | "2xl"
  width,       // number — current viewport px
  height,      // number
  isMobile,    // width < 768
  isTablet,    // 768 ≤ width < 1024
  isDesktop,   // width ≥ 1024
  atLeast,     // (bp) => boolean
  below,       // (bp) => boolean
} = useResponsive();
```

Uses `ResizeObserver` on `document.documentElement` for efficient updates — no `window.resize` flood.

```tsx
const { isMobile, atLeast } = useResponsive();

return (
  <div style={{ padding: atLeast("md") ? "2rem" : "1rem" }}>
    {isMobile ? <CompactView /> : <FullView />}
  </div>
);
```

### `useMediaQuery` hook

For arbitrary CSS media queries:

```ts
const isDark      = useMediaQuery("(prefers-color-scheme: dark)");
const isLandscape = useMediaQuery("(orientation: landscape)");
const isTouch     = useMediaQuery("(pointer: coarse)");
```

### Breakpoint constants

```ts
import { BREAKPOINTS } from "@/lib/theme";

BREAKPOINTS.xs  // 375
BREAKPOINTS.sm  // 640
BREAKPOINTS.md  // 768
BREAKPOINTS.lg  // 1024
BREAKPOINTS.xl  // 1280
BREAKPOINTS["2xl"] // 1400
```

---

## Utility Classes

New utility classes added to `globals.css`:

### Fluid typography

```html
<h1 class="text-fluid-3xl">Scales between 1.875rem and 3rem</h1>
<p  class="text-fluid-base">Scales between 0.875rem and 1rem</p>
```

### Elevation

```html
<div class="elevation-sm">  <!-- var(--shadow-sm) -->
<div class="elevation-md">
<div class="elevation-glow"> <!-- primary glow shadow -->
```

### Glass effect

```html
<div class="glass"> <!-- frosted-glass background -->
```

### Scrollbar utilities

```html
<div class="scrollbar-thin">   <!-- thin styled scrollbar -->
<div class="scrollbar-hidden"> <!-- hidden scrollbar -->
```

### Touch target

```html
<button class="touch-target"> <!-- min 44×44px (WCAG 2.5.5) -->
```

### Safe area padding

```html
<div class="pb-safe pt-safe"> <!-- env(safe-area-inset-*) -->
```

### Z-index helpers

```html
<div class="z-modal">   <!-- var(--z-modal) = 400 -->
<div class="z-tooltip"> <!-- var(--z-tooltip) = 600 -->
```

### Text gradient

```html
<span class="text-gradient">Gradient text using primary colour</span>
```

---

## Hooks Reference

| Hook | File | Purpose |
|------|------|---------|
| `useThemeConfig()` | `hooks/useThemeConfig.ts` | Apply theme settings, accent colour, compact mode |
| `useResponsive()` | `hooks/useResponsive.ts` | Reactive breakpoints and viewport dimensions |
| `useMediaQuery(q)` | `hooks/useResponsive.ts` | Arbitrary CSS media query |

---

## Style Analytics & Monitoring

### `trackStyleEvent(type, detail?)`

Every theme/style change is tracked in session storage and forwarded to `gtag`:

| Event type | Triggered by |
|------------|-------------|
| `theme_changed` | `useThemeConfig.setMode()` |
| `accent_changed` | `applyAccentColor()` |
| `compact_mode` | `applyCompactMode()` |
| `animations_toggled` | `applyAnimationsEnabled()` |
| `responsive_breakpoint` | (available for manual tracking) |

```ts
import { trackStyleEvent, getStyleEvents, getStyleSummary, clearStyleEvents } from "@/lib/theme";

const events  = getStyleEvents();   // StyleAnalyticsEntry[]
const summary = getStyleSummary();  // Record<StyleEventType, number>
clearStyleEvents();
```

### `StyleMonitorDashboard`

Developer/admin component showing:
- Live design token colour swatches
- Responsive breakpoint ruler with current viewport position
- Style event log with filter controls

```tsx
import { StyleMonitorDashboard } from "@/components/common/StyleMonitorDashboard";

{isAdmin && <StyleMonitorDashboard />}
```

---

## Testing

### Test file

`src/__tests__/styles.test.ts` — 50+ cases:

| Area | Cases |
|------|-------|
| `token()` | Wraps token, all common tokens |
| `css()` | Returns unchanged, accepts token() |
| `cssmerge()` | Merges, later wins, ignores falsy |
| `BREAKPOINTS` | All values defined, ascending order |
| `getBreakpoint()` | All 6 breakpoints from window.innerWidth |
| `isAtLeast()` / `isBelow()` | Correct boolean results |
| `responsive()` | base, specific bp, fallback, empty |
| `applyAccentColor()` | Sets/removes data-accent, tracks event |
| `getAccentColor()` | Returns blue default, current value |
| `ACCENT_HSL` | All 6 colours defined |
| `applyCompactMode()` | Adds/removes compact class |
| `applyAnimationsEnabled()` | Adds/removes reduce-motion class |
| Style analytics | Track, order, summary counts, clear, timestamp |

```bash
npm test -- --testPathPattern="styles"
```

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| No CSS-in-JS runtime (emotion/styled-components) | Zero bundle overhead; Tailwind + CSS vars achieves the same type-safety via `token()` and `css()` helpers |
| CSS custom properties for tokens | Runtime theming without JS re-renders; works with SSR |
| `data-accent` attribute for accent colours | Pure CSS — no JS re-render when accent changes |
| `ResizeObserver` in `useResponsive` | More efficient than `window.resize`; handles layout shifts from scrollbar appearance |
| `sessionStorage` for style analytics | Style preferences are session-scoped; avoids long-term accumulation |
| Fluid typography via `clamp()` | Smooth scaling without breakpoint jumps; no extra JavaScript |
