# ArenaX Routing Architecture

## Overview

ArenaX uses the **Next.js 14 App Router** with `next-intl` for i18n. All locale-aware routes live under `src/app/[locale]/`. The routing system provides dynamic routes, layered route guards, code splitting, analytics tracking, and monitoring.

---

## Directory Structure

```
src/
├── app/
│   ├── [locale]/           # All locale-aware routes (en, es, ar, fr, yo)
│   │   ├── layout.tsx      # Root locale layout — providers + RouteChangeMonitor
│   │   ├── page.tsx        # Home page (public)
│   │   ├── dashboard/      # Authenticated dashboard (verified)
│   │   ├── admin/          # Admin-only area (admin role)
│   │   │   ├── access-denied/  # Public — shown on 403
│   │   │   └── ...
│   │   ├── matches/[id]/   # Dynamic match route
│   │   ├── tournaments/[id]/   # Dynamic tournament route
│   │   ├── profile/[id]/   # Dynamic public profile
│   │   ├── governance/[id]/    # Dynamic governance proposal
│   │   └── achievements/[id]/ # Dynamic achievement
│   ├── api/                # API route handlers (no guard — backend enforces auth)
│   └── layout.tsx          # Root layout (non-locale)
├── middleware.ts            # Edge middleware — auth/role enforcement
├── lib/
│   ├── routeConfig.ts       # Route requirement definitions
│   └── routeAnalytics.ts    # Route event tracking utilities
├── hooks/
│   └── useRouteMonitoring.ts  # Hook to subscribe to route analytics events
└── components/navigation/
    ├── RouteGuard.tsx        # Client-side route guard component
    ├── RouteChangeMonitor.tsx # Zero-UI page-view tracker
    ├── DynamicPage.tsx       # Code-split page wrapper with error boundary
    ├── ProtectedPage.tsx     # Legacy admin guard (kept for compatibility)
    └── ProtectedLink.tsx     # Auth-aware link component
```

---

## Route Requirements

Defined centrally in `src/lib/routeConfig.ts`:

| Requirement  | Description                                 |
|-------------|---------------------------------------------|
| `public`    | No auth required                            |
| `auth`      | Must be logged in                           |
| `verified`  | Must be logged in **and** email verified    |
| `admin`     | Must have `admin` role                      |
| `moderator` | Must have `admin` or `moderator` role       |

### Route Groups (for analytics)

`auth`, `dashboard`, `gaming`, `social`, `admin`, `settings`, `public`

---

## Guard Layers

Protection is enforced at two layers:

### Layer 1 — Edge Middleware (`src/middleware.ts`)

Runs before the page renders on the server. Handles:
- No token → redirect to `/[locale]/login?redirect=<path>`
- Expired token → redirect to `/[locale]/login?reason=expired`
- Invalid signature → redirect to `/[locale]/login`
- Admin route + non-admin role → redirect to `/[locale]/admin/access-denied`

The middleware is locale-aware. It strips the locale prefix before classifying routes, so `/en/dashboard` and `/fr/dashboard` both match the `auth` requirement.

**Configuration** — run on all paths except static assets and API routes:
```ts
matcher: ["/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|icons/|api/).*))"]
```

### Layer 2 — `RouteGuard` component (`src/components/navigation/RouteGuard.tsx`)

Client-side defence-in-depth for when auth state diverges from cookie state (e.g., sessionStorage-only tokens). Renders:
- Loading skeleton while auth resolves
- `null` + triggers redirect for unauthenticated users
- Email verification prompt for unverified users on `verified` routes
- Inline 403 Forbidden for wrong-role users

```tsx
// Usage
<RouteGuard requirement="verified">
  <DashboardContent />
</RouteGuard>

// With custom loading UI
<RouteGuard requirement="admin" loadingFallback={<AdminSkeleton />}>
  <AdminPanel />
</RouteGuard>
```

---

## Dynamic Routes

All dynamic segments follow Next.js App Router conventions:

| Segment             | Path Example                           |
|--------------------|----------------------------------------|
| `[locale]`         | `/en`, `/ar`, `/fr`, `/es`, `/yo`     |
| `[id]`             | `/en/tournaments/abc-123`             |
| `[id]/bracket`     | `/en/tournaments/abc-123/bracket`     |
| `[id]/results`     | `/en/tournaments/abc-123/results`     |

### `generateStaticParams`

For routes with known IDs (e.g., locale list), `generateStaticParams` is implemented to pre-render at build time:

```ts
// src/app/[locale]/layout.tsx
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
```

For user-generated content (tournaments, matches, profiles) the app uses **ISR** — pages are rendered on-demand and cached. The `not-found.tsx` file in each dynamic segment handles missing IDs:

```
src/app/[locale]/tournaments/[id]/not-found.tsx
src/app/[locale]/matches/[id]/not-found.tsx
```

---

## Code Splitting

### Next.js `dynamic()` (recommended pattern)

```tsx
import dynamic from "next/dynamic";
import { PageLoadingSkeleton } from "@/components/navigation/DynamicPage";

// Heavy chart only loaded when the analytics page is visited
const RevenueChart = dynamic(
  () => import("@/components/analytics/RevenueChart"),
  { loading: () => <PageLoadingSkeleton />, ssr: false }
);
```

### `DynamicPage` wrapper

For pages that need both code splitting **and** a route guard in one shot:

```tsx
import { DynamicPage } from "@/components/navigation/DynamicPage";

export default function WalletPage() {
  return (
    <DynamicPage
      loader={() =>
        import("@/components/wallet/WalletDashboard").then(
          (m) => m.WalletDashboard
        )
      }
      requirement="verified"
      chunkName="WalletDashboard"
    />
  );
}
```

`DynamicPage` provides:
- Guard enforcement via `RouteGuard`
- `React.lazy` + `Suspense` for the split chunk
- `ChunkErrorBoundary` that catches load failures and shows a retry UI
- Automatic chunk failure tracking via `routeAnalytics`

---

## Route Analytics

Implemented via custom DOM events so the analytics layer has zero hard coupling to the routing layer.

### Events

| Event name                   | Payload                               | Fired when                        |
|-----------------------------|---------------------------------------|-----------------------------------|
| `arenax:route:pageview`     | `RoutePageView[]`                    | Buffer flushed (≥50 or tab hide)  |
| `arenax:route:guard`        | `RouteGuardEvent[]`                  | Buffer flushed after guard fires  |
| `arenax:route:chunkfail`    | `ChunkLoadFailureEvent`              | Immediately on chunk load error   |

### `RouteChangeMonitor`

Zero-UI component mounted inside the locale layout. Detects client-side navigations via `usePathname` + `useSearchParams` changes and calls `trackPageView`.

### `useRouteMonitoring`

Hook to subscribe to route events from any component:

```ts
import { useRouteMonitoring } from "@/hooks/useRouteMonitoring";

useRouteMonitoring({
  onPageView: (views) => sendToAnalytics(views),
  onGuardEvent: (guards) => alertSecurityTeam(guards),
  onChunkFailure: (fail) => logToSentry(fail),
});
```

---

## Route Monitoring

### Metrics tracked

- **Navigation duration** — measured via `PerformanceNavigationTiming` and included in every `RoutePageView` event as `loadDuration`.
- **Guard events** — auth redirects and role denials are tracked with path and locale, making it easy to identify misconfigured pages.
- **Chunk failures** — code-split chunks that fail to download are captured with chunk name, path, and error message.
- **Buffer auto-flush** — the analytics buffer auto-flushes when it reaches 50 events or when `visibilitychange` fires (tab hide / browser close).

---

## Supported Locales

Defined in `src/i18n/routing.ts`:

| Code | Language  | Direction |
|------|-----------|-----------|
| `en` | English   | LTR       |
| `es` | Español   | LTR       |
| `ar` | العربية   | RTL       |
| `fr` | Français  | LTR       |
| `yo` | Yorùbá    | LTR       |

---

## Adding a New Protected Route

1. Add the folder under `src/app/[locale]/your-route/page.tsx`
2. Add an entry to `ROUTE_CONFIGS` in `src/lib/routeConfig.ts`
3. Wrap the page component with `<RouteGuard requirement="verified">`
4. Add a `loading.tsx` and optionally `error.tsx` and `not-found.tsx`

```ts
// src/lib/routeConfig.ts
{ pattern: "/your-route", requirement: "verified", group: "dashboard" },
```

```tsx
// src/app/[locale]/your-route/page.tsx
"use client";
import { RouteGuard } from "@/components/navigation/RouteGuard";

export default function YourRoutePage() {
  return (
    <RouteGuard requirement="verified">
      <YourContent />
    </RouteGuard>
  );
}
```

---

## Testing

Routing tests live in `src/__tests__/routing.test.tsx` and cover:

- `routeConfig` — path classification and locale stripping
- `routeAnalytics` — event buffering, dispatch, and auto-flush
- `useRouteMonitoring` — event subscription and cleanup
- `RouteGuard` — all auth/role/verification states
- `ROUTE_CONFIGS` — integrity (no duplicate patterns, valid requirements)

Run with:
```bash
npx jest --testPathPattern="routing.test" --forceExit
```
