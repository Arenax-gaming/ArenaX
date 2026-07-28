#!/usr/bin/env node
/**
 * Fails if any user-facing page route exists under src/app/ outside of
 * src/app/[locale]/ (issue #729).
 *
 * next-intl's middleware (localePrefix: "always") already redirects every
 * non-locale-prefixed request to its /<locale>/... equivalent, so a page
 * file placed directly under src/app/ (e.g. src/app/matches/[id]/page.tsx)
 * is never actually reachable by real traffic -- it's dead code that's
 * easy to add by accident (e.g. copy-pasting a route while it's still
 * being built) and easy to forget to delete once the [locale] version
 * lands. This check keeps routes from silently duplicating again.
 *
 * Allowed outside src/app/[locale]/:
 *  - src/app/api/**            (API routes are not localized pages)
 *  - src/app/layout.tsx        (root layout is required by Next.js)
 *  - src/app/{sitemap,robots}.ts / manifest.ts  (site-wide metadata routes)
 *  - global-error.tsx           (must be defined at the root per Next.js)
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP_DIR = new URL("../src/app", import.meta.url).pathname;

const ALLOWED_TOP_LEVEL_DIRS = new Set(["[locale]", "api"]);
const ALLOWED_TOP_LEVEL_FILES = new Set([
  "layout.tsx",
  "global-error.tsx",
  "robots.ts",
  "sitemap.ts",
  "manifest.ts",
]);

const PAGE_FILE_PATTERN = /^page\.(tsx|ts|jsx|js)$/;

function findPageFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      found.push(...findPageFiles(fullPath));
    } else if (PAGE_FILE_PATTERN.test(entry)) {
      found.push(fullPath);
    }
  }
  return found;
}

function main() {
  const topLevelEntries = readdirSync(APP_DIR);
  const offendingPages = [];

  for (const entry of topLevelEntries) {
    const fullPath = join(APP_DIR, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (ALLOWED_TOP_LEVEL_DIRS.has(entry)) continue;
      offendingPages.push(...findPageFiles(fullPath));
    } else if (PAGE_FILE_PATTERN.test(entry)) {
      offendingPages.push(fullPath);
    } else if (!ALLOWED_TOP_LEVEL_FILES.has(entry)) {
      // Non-page files (helpers, styles) outside an allowed dir are fine;
      // only page.tsx files define a navigable route.
      continue;
    }
  }

  if (offendingPages.length > 0) {
    console.error(
      "\n❌ Found page route(s) outside src/app/[locale]/. These are " +
        "unreachable in production (next-intl's middleware always redirects " +
        "to a locale-prefixed path first) and should live under " +
        "src/app/[locale]/ instead:\n",
    );
    for (const page of offendingPages) {
      console.error(`  - ${relative(process.cwd(), page)}`);
    }
    console.error(
      "\nMove the page under src/app/[locale]/, or add its directory to " +
        "ALLOWED_TOP_LEVEL_DIRS in scripts/check-no-duplicate-routes.mjs " +
        "if it's genuinely meant to be non-localized.\n",
    );
    process.exit(1);
  }

  console.log("✅ No duplicate non-localized routes found.");
}

main();
