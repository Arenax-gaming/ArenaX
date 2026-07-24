#!/usr/bin/env node

const newman = require('newman');
const path = require('path');
const fs = require('fs');

const COLLECTIONS_DIR = path.join(__dirname, '..', '..', 'postman', 'collections');
const ENVIRONMENT_PATH = path.join(__dirname, '..', '..', 'postman', 'environments', 'dev.postman_environment.json');

const collectionName = process.argv[2];

if (!collectionName) {
  console.error('Usage: node run-collection.js <collection-name>');
  console.error('Available collections:');
  const available = fs.readdirSync(COLLECTIONS_DIR)
    .filter(f => f.endsWith('.collection.json'))
    .map(f => '  ' + path.basename(f, '.collection.json'));
  console.error(available.join('\n'));
  process.exit(1);
}

const collectionPath = path.join(COLLECTIONS_DIR, `${collectionName}.collection.json`);

if (!fs.existsSync(collectionPath)) {
  console.error(`Collection not found: ${collectionPath}`);
  console.error('Available collections:');
  const available = fs.readdirSync(COLLECTIONS_DIR)
    .filter(f => f.endsWith('.collection.json'))
    .map(f => '  ' + path.basename(f, '.collection.json'));
  console.error(available.join('\n'));
  process.exit(1);
}

async function run() {
  const environment = JSON.parse(fs.readFileSync(ENVIRONMENT_PATH, 'utf8'));

  console.log(`Running collection: ${collectionName}\n`);

  const summary = await newman.run({
    collection: collectionPath,
    environment: environment,
    reporters: ['cli'],
  });

  const failures = summary.run.failures.length;

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  } else {
    console.log('\nAll tests passed.');
  }
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
