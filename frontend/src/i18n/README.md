# ArenaX i18n Architecture

This document describes the internationalization (i18n) system for the ArenaX frontend, implemented as part of [Issue #696](https://github.com/Arenax-gaming/ArenaX/issues/696).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Directory Structure](#2-directory-structure)
3. [Supported Locales](#3-supported-locales)
4. [Namespace Guidelines](#4-namespace-guidelines)
5. [Locale Detection](#5-locale-detection)
6. [Adding a New Language](#6-adding-a-new-language)
7. [Adding New Translation Keys](#7-adding-new-translation-keys)
8. [Monitoring & Analytics](#8-monitoring--analytics)
9. [Testing](#9-testing)
10. [Performance Notes](#10-performance-notes)

---

## 1. Overview

ArenaX uses [**next-intl**](https://next-intl-docs.vercel.app/) (v3) on top of Next.js 14 App Router. Key design goals:

- **Scalable namespaces** — translations are grouped by feature area, not dumped in a single flat object.
- **Dynamic loading** — each locale bundle is loaded only when that locale is actually served (`await import(`../messages/${locale}.json`)`) so inactive languages add zero bytes to the initial bundle.
- **Robust fallback** — unknown keys surface the key path (e.g. `"auth.loginButton"`) rather than crashing; missing locales serve a 404.
- **Automatic locale detection** with a four-level priority chain (see §5).
- **Developer monitoring** — missing keys are logged in dev/staging and tracked in memory for a dev-overlay panel.
- **Analytics integration** — every locale change is forwarded to the `AnalyticsService` event bus.

---

## 2. Directory Structure

```
frontend/src/
├── i18n/
│   ├── routing.ts          # Locale list, RTL flags, labels, createNavigation
│   ├── request.ts          # Server-side message loader (next-intl/server)
│   ├── localeDetection.ts  # Client-side locale detection (4-level priority)
│   └── monitoring.ts       # Missing-key reporting & locale-change analytics
│
├── messages/               # One JSON file per locale
│   ├── en.json             # English  (canonical / source of truth)
│   ├── es.json             # Spanish
│   ├── fr.json             # French
│   ├── ar.json             # Arabic  (RTL)
│   └── yo.json             # Yoruba  (Nigerian context)
│
├── hooks/
│   ├── useLocalization.ts  # Intl formatting helpers (dates, numbers, currency)
│   └── useLocaleSwitch.ts  # Locale switching with persistence + analytics
│
└── __tests__/
    └── i18n.test.ts        # Comprehensive unit & integration tests
```

---

## 3. Supported Locales

| Code | Language | Direction | BCP-47 tag |
|------|----------|-----------|-----------|
| `en` | English  | LTR       | `en-US`   |
| `es` | Spanish  | LTR       | `es-ES`   |
| `fr` | French   | LTR       | `fr-FR`   |
| `ar` | Arabic   | **RTL**   | `ar-SA`   |
| `yo` | Yorùbá   | LTR       | `yo-NG`   |

The default locale is **`en`**.

---

## 4. Namespace Guidelines

Every translation file is structured as a JSON object with top-level **namespace keys**:

| Namespace       | Purpose                                                  |
|-----------------|----------------------------------------------------------|
| `common`        | Generic UI labels used everywhere (Save, Cancel, …)     |
| `nav`           | Navigation items and ARIA labels for menus              |
| `auth`          | Login, register, OTP, password reset flows              |
| `gameplay`      | Match-finding, scoring, match details                   |
| `tournaments`   | Tournament listing, creation, joining                   |
| `leaderboard`   | Ranking tables and position change messages             |
| `wallet`        | Deposits, withdrawals, transaction history              |
| `profile`       | Public/private profile fields and actions               |
| `settings`      | All settings pages (appearance, notifications, …)       |
| `errors`        | Error messages and form-validation strings              |
| `date`          | Relative date strings and month/day names               |
| `achievements`  | Achievement unlock messages and rarity labels           |
| `notifications` | Notification titles and body text                       |
| `accessibility` | ARIA labels, skip-links, screen-reader-only strings     |

**Rules:**
- English (`en.json`) is the **source of truth**. All other locales must mirror its key structure exactly.
- Keep keys in `camelCase`.
- Use ICU message format for interpolation: `"Welcome {name}"`, `"You have {count} items"`.
- Never put HTML inside translation strings.

---

## 5. Locale Detection

`src/i18n/localeDetection.ts` implements a four-level priority chain:

```
1. localStorage  ("arenax:locale")
        ↓ not found / invalid
2. URL ?lang=    e.g. ?lang=fr
        ↓ not present / invalid
3. navigator.language  (browser preference)
        ↓ not supported
4. Fallback → "en"
```

### Server-side (Accept-Language header)

```ts
import { detectFromAcceptLanguage } from "@/i18n/localeDetection";
const locale = detectFromAcceptLanguage(request.headers.get("accept-language"));
```

### Client-side

```ts
import { detectLocale } from "@/i18n/localeDetection";
const locale = detectLocale();
```

### Persisting a user choice

```ts
import { persistLocale } from "@/i18n/localeDetection";
persistLocale("yo"); // saved to localStorage under "arenax:locale"
```

---

## 6. Adding a New Language

1. **Add the locale code** to `routing.ts`:

   ```ts
   export const routing = defineRouting({
     locales: ["en", "es", "ar", "fr", "yo", "pt"], // ← add "pt"
     …
   });
   ```

2. **Add metadata** in `routing.ts`:

   ```ts
   export const LOCALE_LABELS: Record<Locale, string> = {
     …
     pt: "Português",
   };

   export const LOCALE_BCP47: Record<Locale, string> = {
     …
     pt: "pt-BR",
   };
   ```

3. **Add RTL flag** if needed:

   ```ts
   export const RTL_LOCALES: readonly Locale[] = ["ar", "he"]; // example
   ```

4. **Create the translation file** at `src/messages/pt.json`.
   - Start by copying `en.json` and translating values.
   - Every key from `en.json` must be present — the test suite enforces this.

5. **Run the tests** to confirm completeness:

   ```bash
   cd frontend && npm test -- --testPathPattern=i18n
   ```

---

## 7. Adding New Translation Keys

1. Add the key and English value to `src/messages/en.json` under the appropriate namespace.
2. Add the translated value to **all other locale files** (`es.json`, `fr.json`, `ar.json`, `yo.json`, …).
3. Run `npm test -- --testPathPattern=i18n` — the completeness check will fail if any locale is missing the key.

### Using a translation in a component

```tsx
import { useTranslations } from "next-intl";

export function LoginButton() {
  const t = useTranslations("auth");
  return <button>{t("loginButton")}</button>;
}
```

### With interpolation

```tsx
const t = useTranslations("errors");
// en.json: "rateLimitMessage": "Wait {seconds} seconds and try again."
t("rateLimitMessage", { seconds: 30 });
```

---

## 8. Monitoring & Analytics

### Missing key monitoring (dev/staging only)

`src/i18n/monitoring.ts` captures missing keys when next-intl's `onError` / `getMessageFallback` fires:

```ts
import { reportMissingKey, getMissingKeys } from "@/i18n/monitoring";

// Manually inspect what's missing
console.table(getMissingKeys());
```

In `src/i18n/request.ts` the `onError` callback is wired up automatically to `reportMissingKey` in non-production builds.

### Locale change analytics

Every call to `switchLocale()` (from `useLocaleSwitch`) fires:

```ts
analyticsService.track("locale_changed", { from, to, source });
```

`source` can be `"user"`, `"auto-detect"`, `"url-param"`, or `"storage"`.

### Dev diagnostics

```ts
import { printI18nDiagnostics } from "@/i18n/monitoring";
printI18nDiagnostics(); // prints missing keys + locale history to console
```

---

## 9. Testing

The test suite lives at `src/__tests__/i18n.test.ts` and covers:

| Category | What is tested |
|---|---|
| **Routing** | Locale list, default locale, RTL detection, labels, BCP-47 tags |
| **Detection — localStorage** | Valid value, invalid value, case-insensitive |
| **Detection — URL param** | `?lang=es`, unsupported value, Yoruba |
| **Detection — navigator.language** | Subtag normalisation, fallback |
| **Detection — Accept-Language header** | Quality value parsing, fallback |
| **Persistence** | `persistLocale`, `clearPersistedLocale` |
| **Monitoring** | Missing key recording, deduplication, sorting |
| **Locale change tracking** | Record shape, null→locale, cap at 50 |
| **Translation completeness** | All locales share the same keys as English |
| **Message structure** | Namespace presence, required keys |

Run the i18n tests only:

```bash
cd frontend
npm test -- --testPathPattern=i18n
```

Run all frontend tests:

```bash
cd frontend
npm test
```

---

## 10. Performance Notes

- **Bundle size** — locale bundles are loaded with dynamic `import()` per request. Only the active locale is ever included in the response.
- **No re-renders on switch** — `useLocaleSwitch` calls `router.replace()` which triggers a navigation (and thus a server fetch of the new bundle) rather than a client-side state mutation. This avoids partial hydration mismatches.
- **RTL layout** — the `<html dir="rtl">` attribute is set server-side in `layout.tsx` based on `RTL_LOCALES`, ensuring the first paint is correct with no flash.
- **Caching** — message JSON files are statically analysed by Next.js and served with immutable cache headers in production.
