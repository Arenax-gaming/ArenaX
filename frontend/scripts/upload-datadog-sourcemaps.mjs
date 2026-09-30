/**
 * Datadog source map uploader — Issue #1100.
 *
 * Uploads the Browser Source Maps produced by `next build` (with
 * `productionBrowserSourceMaps: true`) to Datadog so production JavaScript
 * errors render meaningful file/line references instead of minified stacks.
 *
 * Runs as the `postbuild` / `upload:sourcemaps` npm script. It is a no-op
 * (exit 0) unless the Datadog credentials are configured, so CI builds that
 * don't have secrets are unaffected:
 *
 *   DATADOG_API_KEY             (or DD_API_KEY)
 *   DATADOG_APPLICATION_KEY     (or DD_APP_KEY / DD_APPLICATION_KEY)
 *   DATADOG_SITE                (optional, default: datadoghq.com)
 *   DATADOG_SERVICE             (optional, default: arenax-frontend)
 *   NEXT_PUBLIC_APP_VERSION     (optional — release version must match the
 *                                version configured in RumProvider)
 *
 * Uses Node's built-in fetch (Node >= 18) so no extra dependency is needed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, posix, relative } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const API_KEY =
  process.env.DATADOG_API_KEY || process.env.DD_API_KEY || "";
const APP_KEY =
  process.env.DATADOG_APPLICATION_KEY ||
  process.env.DD_APP_KEY ||
  process.env.DD_APPLICATION_KEY ||
  "";
const SITE = process.env.DATADOG_SITE || "datadoghq.com";
const SERVICE = process.env.DATADOG_SERVICE || "arenax-frontend";
const VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION || process.env.DATADOG_VERSION || "";

const NEXT_DIR = join(ROOT, ".next");

function collectSourceMaps(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceMaps(full, out);
    } else if (entry.endsWith(".js.map")) {
      out.push(full);
    }
  }
  return out;
}

async function uploadSourceMap(sourceMapPath) {
  const jsPath = sourceMapPath.replace(/\.map$/, "");
  if (!existsSync(jsPath)) return null;

  const path = posix.relative(ROOT, jsPath).replaceAll("\\", "/");

  return {
    platform: "browser",
    path,
    sourcemap: readFileSync(sourceMapPath, "utf8"),
    source: readFileSync(jsPath, "utf8"),
  };
}

async function main() {
  if (!API_KEY || !APP_KEY) {
    console.log(
      "[datadog-sourcemaps] DATADOG_API_KEY / DATADOG_APPLICATION_KEY not set — skipping source map upload.",
    );
    return 0;
  }

  const maps = collectSourceMaps(NEXT_DIR);
  if (maps.length === 0) {
    console.log(
      "[datadog-sourcemaps] No source maps found under .next — was `next build` run with productionBrowserSourceMaps?",
    );
    return 0;
  }

  const files = [];
  for (const mapPath of maps) {
    const file = await uploadSourceMap(mapPath);
    if (file) files.push(file);
  }

  console.log(
    `[datadog-sourcemaps] Uploading ${files.length} source maps to ${SITE} (service=${SERVICE}, version=${VERSION || "unknown"})…`,
  );

  const endpoint = `https://api.${SITE}/api/v2/srcmap`;
  const chunkSize = 100;
  let uploaded = 0;

  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "DD-API-KEY": API_KEY,
        "DD-APPLICATION-KEY": APP_KEY,
      },
      body: JSON.stringify({
        service: SERVICE,
        version: VERSION,
        cli_version: "arenax-1.0.0",
        files: chunk,
      }),
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      console.error(
        `[datadog-sourcemaps] Upload failed (HTTP ${res.status}): ${body}`,
      );
      return 1;
    }
    uploaded += chunk.length;
    console.log(
      `[datadog-sourcemaps] Uploaded ${uploaded}/${files.length} source maps.`,
    );
  }

  console.log("[datadog-sourcemaps] Done.");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[datadog-sourcemaps] Unexpected failure:", err);
    process.exit(1);
  });