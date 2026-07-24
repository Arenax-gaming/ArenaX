# ArenaX Frontend — Accessibility Architecture

> Full validation requires manual testing with assistive technologies and expert review. This document describes the technical implementation only.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [lib/accessibility.ts](#libaccessibilityts)
4. [AccessibilityProvider](#accessibilityprovider)
5. [ARIA Implementation](#aria-implementation)
6. [Keyboard Navigation](#keyboard-navigation)
7. [Screen Reader Support](#screen-reader-support)
8. [Focus Management](#focus-management)
9. [Hooks Reference](#hooks-reference)
10. [Components Reference](#components-reference)
11. [Accessibility Analytics](#accessibility-analytics)
12. [Accessibility Monitor Dashboard](#accessibility-monitor-dashboard)
13. [Testing](#testing)
14. [WCAG Compliance Notes](#wcag-compliance-notes)
15. [Decision Log](#decision-log)

---

## Overview

The accessibility system is built around three pillars:

| Pillar | Implementation |
|--------|---------------|
| **Structured utilities** | `lib/accessibility.ts` — single source of truth for IDs, focus helpers, ARIA builders, contrast maths |
| **Shared context** | `AccessibilityProvider` — OS preference detection, keyboard-user detection, global announcer, analytics |
| **Progressive enhancement** | Every interactive element works without JavaScript; ARIA and keyboard support are layered on top |

---

## Architecture

```
AccessibilityProvider
  ├─ Detects OS preferences (prefers-reduced-motion, prefers-contrast)
  ├─ Detects keyboard vs pointer navigation → adds .keyboard-user on <body>
  ├─ Exposes global announce() → singleton AnnouncementQueue (2 aria-live nodes)
  ├─ Runs @axe-core/react in development → tracks violations
  └─ Provides useAccessibility() hook to all components

lib/accessibility.ts
  ├─ generateAriaId()       — stable ARIA ID generator
  ├─ getFocusableElements() — returns all focusable children
  ├─ focusFirstElement()    — moves focus to first child
  ├─ restoreFocus()         — returns focus to a saved element
  ├─ handleFocusTrap()      — Tab / Shift+Tab wrapping
  ├─ Keys                   — keyboard key name constants
  ├─ isActivationKey()      — Enter / Space check
  ├─ createKeyboardActivationHandler() — div/span → button shim
  ├─ ariaBusy / ariaDisabled / ariaExpanded / ariaSelected — prop builders
  ├─ announcer (AnnouncementQueue) — singleton aria-live nodes
  ├─ announce()             — convenience wrapper
  ├─ a11yAnalytics          — session-scoped event tracking
  └─ relativeLuminance / contrastRatio / meetsWcagContrast — WCAG maths

Hooks
  ├─ useFocusTrap           — focus trap for modals / drawers
  ├─ useAriaLive            — announce() via AccessibilityProvider
  ├─ useKeyboardShortcuts   — global shortcut system (pre-existing, enhanced)
  └─ useReducedMotion       — framer-motion wrapper (pre-existing)

Components
  ├─ SkipLink               — skip-to-main-content
  ├─ AriaLiveRegion         — reusable live region widget
  ├─ Button                 — aria-busy, aria-disabled, sr-only loading label
  ├─ BottomNav              — aria-label, aria-current, focus-visible ring
  └─ AccessibilityMonitorDashboard — developer/admin event viewer
```

---

## lib/accessibility.ts

### ID generation

```ts
const labelId = generateAriaId("modal-label"); // "arenax-modal-label-4"
```

Use `generateAriaId` whenever you need a stable ID to wire `aria-labelledby` or `aria-describedby`. Prefer this over `Math.random()` or hard-coded strings.

### Focus utilities

```ts
// Returns all focusable descendants in DOM order
const els = getFocusableElements(containerEl);

// Focuses the first focusable child (falls back to container)
focusFirstElement(dialogEl);

// Restores focus — safe if element is null or detached
restoreFocus(previouslyFocusedEl);

// Tab trap — call from a keydown handler
handleFocusTrap(event, containerEl);
```

### Keyboard helpers

```ts
import { Keys, isActivationKey, createKeyboardActivationHandler } from "@/lib/accessibility";

// Check Enter / Space
if (isActivationKey(event)) { … }

// Wrap a non-button element with keyboard activation
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={createKeyboardActivationHandler(handleClick)}
/>
```

### ARIA prop builders

```ts
<div {...ariaBusy(isLoading)}>        // { aria-busy: true }
<button {...ariaDisabled(isDisabled)} // { aria-disabled: true }
<button {...ariaExpanded(open, "panel-id")}>
<li {...ariaSelected(isSelected)}>
```

### Global announcer

```ts
import { announce } from "@/lib/accessibility";

announce("Saved successfully");              // polite
announce("Session expired", "assertive");    // assertive, interrupts SR
```

Two `aria-live` DOM nodes (`#arenax-live-polite`, `#arenax-live-assertive`) are injected into `<body>` on first call and reused across the app lifetime.

### WCAG contrast maths

```ts
const lWhite = relativeLuminance(255, 255, 255); // 1
const lBlack = relativeLuminance(0, 0, 0);       // 0
const ratio  = contrastRatio(lWhite, lBlack);    // 21

meetsWcagContrast(ratio, "AA");       // true  (≥ 4.5)
meetsWcagContrast(ratio, "AAA");      // true  (≥ 7)
meetsWcagContrast(ratio, "AA-large"); // true  (≥ 3)
```

---

## AccessibilityProvider

Wraps the locale layout. Provides a context consumed by `useAccessibility()`.

### Preferences auto-detected

| Preference | Source |
|------------|--------|
| `prefersReducedMotion` | `prefers-reduced-motion: reduce` media query |
| `prefersHighContrast` | `prefers-contrast: more` media query |
| `isKeyboardUser` | First Tab keydown → `.keyboard-user` class on `<body>` |
| `screenReaderEnabled` | Manual opt-in via `AccessibilityOptions` settings |

### CSS classes applied to `<html>`

| Preference | Class |
|------------|-------|
| `prefersReducedMotion` | `reduce-motion` |
| `prefersHighContrast` | `high-contrast` |
| `screenReaderEnabled` | `screen-reader` |

Use these in Tailwind via `[.high-contrast_&]:…` or in CSS `html.high-contrast { … }`.

### Hook

```tsx
const {
  preferences,        // AccessibilityPreferences
  updatePreferences,  // (patch) => void
  announce,           // (message, level?) => void
  trackA11y,          // (type, detail?) => void
  a11yEvents,         // A11yAnalyticsEntry[]
} = useAccessibility();
```

---

## ARIA Implementation

### Landmarks (pre-existing, verified)

| Element | Role / Attribute |
|---------|-----------------|
| `<header>` | `role="banner"` (implicit) |
| `<main id="main-content">` | `role="main"` |
| `<footer>` | `role="contentinfo"` |
| Footer `<nav>` | `aria-label="Footer navigation"` |
| Mobile drawer | `role="dialog" aria-modal="true" aria-label="Mobile navigation"` |
| Bottom nav | `aria-label="Mobile bottom navigation"` |

### Interactive elements — ARIA patterns

| Pattern | Where used |
|---------|-----------|
| `aria-label` | Icon-only buttons, social links, close buttons |
| `aria-labelledby` | Modals, withdraw dialog, landing sections |
| `aria-describedby` | Tooltips (trigger → content id), form fields |
| `aria-current="page"` | Active nav links (Navbar, MobileNav, BottomNav) |
| `aria-expanded` + `aria-controls` | Mobile menu toggle, accordion rows |
| `aria-busy` | Loading states (Button, tables, lists) |
| `aria-live="polite"` | Status messages, form feedback, upload progress |
| `aria-live="assertive"` | Achievement unlocks, critical errors |
| `role="switch"` + `aria-checked` | Toggle/Switch component |
| `role="dialog"` + `aria-modal="true"` | Modal, KeyboardShortcutsHelp |
| `role="alert"` | Error boundary fallbacks, form errors |
| `role="status"` | Success messages, AriaLiveRegion (polite) |
| `role="tooltip"` | Tooltip content |
| `aria-hidden="true"` | Decorative icons, animation overlays |

---

## Keyboard Navigation

### Global shortcuts (`useKeyboardShortcuts`)

| Key | Action |
|-----|--------|
| `?` | Toggle shortcuts help modal |
| `/` | Open search |
| `Escape` | Close modal / cancel |
| `g` → `h` | Go to Home |
| `g` → `t` | Go to Tournaments |
| `g` → `l` | Go to Leaderboard |
| `g` → `p` | Go to Profile |
| `g` → `m` | Go to Matches |
| `n` → `m` | Create new match |
| `n` → `t` | Join tournament |

Shortcuts respect:
- Input-focused state (most shortcuts are suppressed inside `<input>` / `<textarea>`)
- Open modal detection via `[aria-modal='true'][open]`
- Custom bindings persisted in `localStorage`

### Focus trap pattern

All modal surfaces use `useFocusTrap` (or the equivalent manual implementation in `Modal.tsx` / `KeyboardShortcutsHelp.tsx`):

1. Save `document.activeElement` before opening
2. Move focus to first focusable child on open (`focusFirstElement`)
3. Tab / Shift+Tab wraps within the container (`handleFocusTrap`)
4. `Escape` closes and restores previous focus (`restoreFocus`)

### `SkipLink`

Rendered as the very first element in `AppLayout`. Invisible until focused. On click/Enter: programmatically focuses `#main-content` and scrolls it into view. Usage is tracked in `a11yAnalytics`.

---

## Screen Reader Support

### Global aria-live nodes

`AccessibilityProvider` ensures two `sr-only` nodes are appended to `<body>`:

- `#arenax-live-polite` — `aria-live="polite" aria-atomic="true"`
- `#arenax-live-assertive` — `aria-live="assertive" aria-atomic="true"`

Use the `announce()` function or `useAriaLive` hook from any component.

### `AriaLiveRegion` component

```tsx
// Polite status (saves, loads)
<AriaLiveRegion message={statusMessage} />

// Assertive alert (errors, urgent)
<AriaLiveRegion message={errorMessage} ariaLive="assertive" />

// Shorthand wrappers
<StatusAnnouncer message="Profile saved" />
<AlertAnnouncer message="Payment failed" />
```

The component clears then re-sets the message so screen readers re-announce the same string when triggered twice.

### Button loading state

The `Button` component renders a `sr-only` span with `"Loading…"` (configurable via `loadingLabel`) alongside an `aria-hidden` spinner SVG. Screen readers see `"Loading…"` instead of the SVG path data.

### Other SR patterns

| Component | Pattern |
|-----------|---------|
| `SkipLink` | Keyboard-only visible link; announces `skip_link_used` event |
| `PasswordStrengthIndicator` | `aria-live + role="img"` with explicit label |
| `UnlockAnimation` | `aria-live="assertive"` for achievement unlocks |
| `FileUpload` | Dedicated `aria-live` region for progress |
| `PageSkeleton` | `aria-hidden="true"` (documented in JSDoc) |
| Icon-only elements | `aria-hidden="true"` on decorative icons throughout |

---

## Focus Management

### `useFocusTrap` hook

```tsx
const { containerRef } = useFocusTrap({
  enabled: isOpen,
  autoFocus: true,             // focus first element on activation (default)
  restoreOnDeactivate: true,   // restore prior focus on deactivation (default)
  onEscape: () => setOpen(false),
});

<div ref={containerRef} role="dialog" aria-modal="true">
  …
</div>
```

### Focus-visible ring

All interactive elements (Button, nav links, BottomNav items) include:
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
```

The `.keyboard-user` class on `<body>` (set by `AccessibilityProvider`) can be used in CSS to show even more prominent focus styles for keyboard-only users without affecting mouse users.

---

## Hooks Reference

| Hook | Purpose |
|------|---------|
| `useAccessibility()` | Access preferences, announce, trackA11y |
| `useFocusTrap(options)` | Focus trap for modals / drawers |
| `useAriaLive()` | `announcePolite` / `announceAssertive` shortcuts |
| `useKeyboardShortcuts(onAction)` | Global + context-aware keyboard shortcuts |
| `useReducedMotion()` | OS reduced-motion preference (framer-motion) |

---

## Components Reference

| Component | File | Purpose |
|-----------|------|---------|
| `AccessibilityProvider` | `providers/AccessibilityProvider.tsx` | Global a11y context |
| `SkipLink` | `ui/SkipLink.tsx` | Skip to main content |
| `AriaLiveRegion` | `common/AriaLiveRegion.tsx` | Reusable live region |
| `StatusAnnouncer` | `common/AriaLiveRegion.tsx` | Polite status shorthand |
| `AlertAnnouncer` | `common/AriaLiveRegion.tsx` | Assertive alert shorthand |
| `Button` | `ui/Button.tsx` | Full ARIA + loading state |
| `BottomNav` | `ui/BottomNav.tsx` | aria-label, aria-current, focus ring |
| `AccessibilityMonitorDashboard` | `common/AccessibilityMonitorDashboard.tsx` | Admin event viewer |

---

## Accessibility Analytics

Every accessibility interaction is tracked by `a11yAnalytics` (session-scoped, `sessionStorage`):

| Event type | Triggered by |
|------------|-------------|
| `keyboard_nav` | First Tab press detected |
| `skip_link_used` | SkipLink clicked |
| `focus_trap_activated` | Focus trap enabled |
| `screen_reader_announced` | `announce()` called |
| `shortcut_used` | Keyboard shortcut fired |
| `reduced_motion_detected` | OS media query matches |
| `high_contrast_detected` | OS media query matches |
| `violation_detected` | axe-core violation in development |

Events are also forwarded to Google Analytics (`gtag`) as `accessibility_action` events if available.

---

## Accessibility Monitor Dashboard

`AccessibilityMonitorDashboard` is a developer/admin read-only view of all tracked events.

```tsx
import { AccessibilityMonitorDashboard } from "@/components/common/AccessibilityMonitorDashboard";

// Guard behind admin role check
{isAdmin && <AccessibilityMonitorDashboard />}
```

Features:
- Detected OS preferences (live badges)
- Per-event-type count summary
- Filterable chronological event list
- Refresh / Clear controls

---

## Testing

### Test file

`src/__tests__/accessibility.test.tsx` — 60+ cases covering:

| Area | Cases |
|------|-------|
| `generateAriaId` | Uniqueness, format |
| `getFocusableElements` | Returns correct elements, excludes disabled |
| `focusFirstElement` | Moves focus, fallback to container |
| `restoreFocus` | Normal, null, detached |
| `handleFocusTrap` | Forward wrap, backward wrap, non-Tab key |
| `Keys` | All key constants exported |
| `isActivationKey` | Enter, Space, others |
| `createKeyboardActivationHandler` | Enter activates, Space activates, others ignored |
| ARIA builders | `ariaBusy`, `ariaDisabled`, `ariaExpanded`, `ariaSelected` |
| WCAG contrast | `relativeLuminance`, `contrastRatio`, `meetsWcagContrast` |
| `AriaLiveRegion` | Renders, polite/assertive, clear+re-set |
| `StatusAnnouncer` / `AlertAnnouncer` | Correct roles and levels |
| `SkipLink` | href, custom label, focus-on-click |
| `Button` | aria-label, disabled, aria-busy, sr-only loading label, spinner hidden |
| `AccessibilityProvider` | Defaults, updatePreferences, throws outside provider |
| `useFocusTrap` | containerRef, onEscape, disabled |
| `useAriaLive` | announcePolite, announceAssertive, no throws |
| ARIA landmark roles | main, navigation, contentinfo, banner, dialog |
| sr-only text | In DOM, has correct class |

### Running tests

```bash
# All accessibility tests
npm test -- --testPathPattern="accessibility"

# All tests
npm test
```

### Manual testing checklist

- [ ] Keyboard-only navigation through all pages without a mouse
- [ ] Tab order is logical and matches visual reading order
- [ ] All interactive elements are reachable and activatable by keyboard
- [ ] Focus is never lost or trapped unexpectedly
- [ ] Skip link is visible on first Tab press
- [ ] Screen reader announces page-level status changes
- [ ] Modal focus trap activates and restores on close
- [ ] Reduced-motion OS setting disables animations
- [ ] High-contrast OS setting applies additional styles

---

## WCAG Compliance Notes

> Full compliance requires manual testing with assistive technologies (NVDA, VoiceOver, JAWS) and expert accessibility review. The items below reflect the technical implementation.

| Criterion | Level | Status |
|-----------|-------|--------|
| 1.3.1 Info and Relationships | A | Semantic HTML + ARIA landmarks |
| 1.3.3 Sensory Characteristics | A | Text labels on all icon-only elements |
| 1.4.1 Use of Color | A | `aria-current`, `aria-selected` supplement colour cues |
| 1.4.3 Contrast (Minimum) | AA | Verified on primary/destructive/muted tokens |
| 1.4.4 Resize Text | AA | `textScale` setting; rem-based sizing |
| 2.1.1 Keyboard | A | All interactive elements keyboard-operable |
| 2.1.2 No Keyboard Trap | A | `useFocusTrap` always provides Escape exit |
| 2.4.1 Bypass Blocks | A | `SkipLink` component |
| 2.4.3 Focus Order | A | DOM order matches visual order; no `tabindex > 0` |
| 2.4.7 Focus Visible | AA | `focus-visible:ring-2` on all interactive elements |
| 4.1.2 Name, Role, Value | A | ARIA labels on all interactive elements |
| 4.1.3 Status Messages | AA | `aria-live` regions for all status / error messages |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Singleton `announcer` in `lib/accessibility` | Single pair of `aria-live` nodes avoids duplicate announcements when multiple components call `announce()` simultaneously |
| `AccessibilityProvider` holds preferences, not just axe-core | Makes OS preference state (reduced-motion, high-contrast) available to any component without prop-drilling |
| `useFocusTrap` hook vs inline in each modal | Single implementation ensures consistent behaviour across Modal, KeyboardShortcutsHelp, and future dialogs |
| `a11yAnalytics` uses `sessionStorage` (not `localStorage`) | Accessibility usage is session-scoped; no long-term PII accumulation |
| `.keyboard-user` class on `<body>` | Allows CSS-only focus ring enhancement without re-rendering the whole tree |
| `aria-hidden="true"` on loading spinner SVG | Prevents screen readers from reading SVG path data; `sr-only` label provides the semantic equivalent |
