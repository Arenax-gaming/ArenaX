#!/usr/bin/env node
/**
 * Generate or verify `openapi.json` from the `@openapi` JSDoc annotations in
 * `src/routes/` (Issue #1404).
 *
 *   node scripts/openapi.js           # write openapi.json
 *   node scripts/openapi.js --check   # exit 1 if openapi.json is out of sync
 */
const fs = require('fs');
const path = require('path');
const { generateSpec, specPath } = require('../openapi.config.js');

const serialized = JSON.stringify(generateSpec(), null, 2) + '\n';
const relative = path.relative(process.cwd(), specPath);

if (process.argv.includes('--check')) {
  const committed = fs.existsSync(specPath) ? fs.readFileSync(specPath, 'utf8') : '';
  if (committed !== serialized) {
    console.error(
      `${relative} is out of sync with the @openapi annotations in src/routes/.\n` +
        'Run `npm run openapi:generate` and commit the result.',
    );
    process.exit(1);
  }
  console.log(`${relative} is up to date.`);
} else {
  fs.writeFileSync(specPath, serialized);
  const paths = Object.keys(JSON.parse(serialized).paths || {}).length;
  console.log(`Wrote ${relative} (${paths} paths).`);
}
