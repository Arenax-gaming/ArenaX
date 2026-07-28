#!/usr/bin/env node
/**
 * Verifies that the PWA manifest and its referenced icon files exist and are
 * valid before the app is built/deployed. This guards against regressions of
 * the kind described in issue #752, where the manifest and icons were
 * referenced from the app layout but never actually committed to
 * `public/`, silently breaking installability and Lighthouse PWA audits.
 *
 * Usage: node scripts/check-pwa-assets.js
 * Exits non-zero with a descriptive message on any failure.
 */

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'manifest.json');

const REQUIRED_ICON_SIZES = [192, 512];

const errors = [];

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);

  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buf.length < 24 || !buf.subarray(0, 8).equals(pngSignature)) {
    throw new Error('not a valid PNG file (bad signature)');
  }

  // IHDR chunk: 8 bytes signature + 4 bytes length + 4 bytes "IHDR" type,
  // then width (4 bytes BE) and height (4 bytes BE).
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function fail(message) {
  errors.push(message);
}

// 1. Manifest must exist and be valid JSON.
let manifest = null;
if (!fs.existsSync(MANIFEST_PATH)) {
  fail(`Missing required file: ${path.relative(process.cwd(), MANIFEST_PATH)}`);
} else {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    fail(`manifest.json is not valid JSON: ${err.message}`);
  }
}

// 2. Manifest fields.
if (manifest) {
  if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
    fail('manifest.json is missing a non-empty "name" field');
  }
  if (typeof manifest.start_url !== 'string' || manifest.start_url.trim() === '') {
    fail('manifest.json is missing a non-empty "start_url" field');
  }
  if (typeof manifest.display !== 'string' || manifest.display.trim() === '') {
    fail('manifest.json is missing a non-empty "display" field');
  }
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    fail('manifest.json is missing a non-empty "icons" array');
  } else {
    for (const size of REQUIRED_ICON_SIZES) {
      const sizeStr = `${size}x${size}`;
      const entry = manifest.icons.find(
        (icon) => icon && typeof icon.sizes === 'string' && icon.sizes.includes(sizeStr)
      );
      if (!entry) {
        fail(`manifest.json "icons" array is missing an entry for size ${sizeStr}`);
        continue;
      }
      if (typeof entry.src !== 'string' || entry.src.trim() === '') {
        fail(`manifest.json icon entry for ${sizeStr} is missing a "src"`);
        continue;
      }
      const iconPath = path.join(PUBLIC_DIR, entry.src.replace(/^\//, ''));
      if (!fs.existsSync(iconPath)) {
        fail(
          `manifest.json references icon "${entry.src}" for size ${sizeStr}, but the file does not exist at ${path.relative(process.cwd(), iconPath)}`
        );
      }
    }
  }
}

// 3. Icon files must exist and have the correct actual pixel dimensions.
for (const size of REQUIRED_ICON_SIZES) {
  const iconPath = path.join(PUBLIC_DIR, 'icons', `icon-${size}x${size}.png`);
  const relPath = path.relative(process.cwd(), iconPath);

  if (!fs.existsSync(iconPath)) {
    fail(`Missing required file: ${relPath}`);
    continue;
  }

  try {
    const { width, height } = readPngDimensions(iconPath);
    if (width !== size || height !== size) {
      fail(
        `${relPath} has dimensions ${width}x${height}, expected ${size}x${size}`
      );
    }
  } catch (err) {
    fail(`${relPath} could not be read as a valid PNG: ${err.message}`);
  }
}

if (errors.length > 0) {
  console.error('PWA asset check failed:');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log('PWA assets OK');
process.exit(0);
