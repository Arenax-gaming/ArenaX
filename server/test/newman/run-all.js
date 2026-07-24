#!/usr/bin/env node

const newman = require('newman');
const path = require('path');
const fs = require('fs');

const COLLECTIONS_DIR = path.join(__dirname, '..', '..', 'postman', 'collections');
const ENVIRONMENT_PATH = path.join(__dirname, '..', '..', 'postman', 'environments', 'dev.postman_environment.json');
const REPORTS_DIR = path.join(__dirname, '..', '..', 'test', 'newman', 'reports');

const USE_HTMLEXTRA = process.argv.includes('--reporter htmlextra');

async function run() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const collections = fs.readdirSync(COLLECTIONS_DIR)
    .filter(f => f.endsWith('.collection.json'))
    .sort();

  if (collections.length === 0) {
    console.error('No collection files found in', COLLECTIONS_DIR);
    process.exit(1);
  }

  const environment = JSON.parse(fs.readFileSync(ENVIRONMENT_PATH, 'utf8'));

  let totalTests = 0;
  let totalFailures = 0;
  const results = [];

  console.log(`Running ${collections.length} collections...\n`);

  for (const file of collections) {
    const collectionPath = path.join(COLLECTIONS_DIR, file);
    const collectionName = path.basename(file, '.collection.json');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const reporters = ['cli'];
    if (USE_HTMLEXTRA) {
      reporters.push('htmlextra');
    }

    const reporterOptions = {
      cli: { silent: true },
    };

    if (USE_HTMLEXTRA) {
      reporterOptions.htmlextra = {
        export: path.join(REPORTS_DIR, `${collectionName}-${timestamp}.html`),
        browserTitle: `ArenaX API Report - ${collectionName}`,
        title: `ArenaX API Test Report - ${collectionName}`,
        titleSize: 2,
      };
    }

    try {
      const summary = await newman.run({
        collection: collectionPath,
        environment: environment,
        reporters: reporters,
        reporterOptions: reporterOptions,
      });

      const failures = summary.run.failures.length;
      const tests = summary.run.stats.tests ? summary.run.stats.tests.total : 0;
      totalTests += tests;
      totalFailures += failures;

      const status = failures === 0 ? 'PASS' : 'FAIL';
      results.push({ collection: collectionName, status, tests, failures });

      console.log(`  ${status === 'PASS' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${collectionName} (${tests} tests, ${failures} failures)`);
    } catch (err) {
      totalFailures++;
      results.push({ collection: collectionName, status: 'ERROR', tests: 0, failures: 1 });
      console.log(`  \x1b[31m✗\x1b[0m ${collectionName} — ERROR: ${err.message}`);
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`Total: ${collections.length} collections, ${totalTests} tests, ${totalFailures} failures`);

  if (USE_HTMLEXTRA) {
    console.log(`Reports saved to: ${REPORTS_DIR}`);
  }

  process.exit(totalFailures > 0 ? 1 : 0);
}

run();
