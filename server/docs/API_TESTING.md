# API Testing with Postman & Newman

Automated API testing for ArenaX server using Postman collections and Newman runner.

## Structure

```
postman/
  collections/            # Postman collection JSON files (v2.1 schema)
    auth.collection.json
    match.collection.json
    tournament.collection.json
    wallet.collection.json
    admin.collection.json
    search.collection.json
    analytics.collection.json
  environments/
    dev.postman_environment.json
test/newman/
  run-all.js              # Runs all collections
  run-collection.js       # Runs a single collection by name
```

## Quick Start

```bash
# Install dependencies
npm install

# Start the server
npm run dev

# Run all API tests
npm run test:api

# Run with HTML report
npm run test:api:report

# Run a single collection
node test/newman/run-collection.js auth
node test/newman/run-collection.js tournament
```

## Available Collections

| Collection       | Description                      |
|------------------|----------------------------------|
| `auth`           | Register, login, refresh, logout |
| `match`          | Create and retrieve matches      |
| `tournament`     | Create, list, register           |
| `wallet`         | Get wallet, lock escrow          |
| `admin`          | Admin user management            |
| `search`         | Full-text search                 |
| `analytics`      | Track events, dashboard          |

## Environment Variables

The dev environment (`postman/environments/dev.postman_environment.json`) defines:

| Variable              | Default                     |
|-----------------------|-----------------------------|
| `base_url`            | `http://localhost:3000`     |
| `test_email`          | `test@arenax.gg`            |
| `test_password`       | `TestPassword123!`          |
| `admin_email`         | `admin@arenax.gg`           |
| `admin_password`      | `AdminPassword123!`         |

Override values by importing the environment into Postman or editing the JSON.

## Adding a New Collection

1. Create `postman/collections/<name>.collection.json` using the Postman Collection v2.1 schema.
2. Use `{{base_url}}` for all URLs.
3. Add test scripts that validate status codes and response structure.
4. Use `pm.collectionVariables.set()` to chain data between requests (e.g. save auth tokens).
5. The `run-all.js` script automatically discovers all `*.collection.json` files in the collections directory.

## CI/CD Integration

The GitHub Actions workflow (`.github/workflows/api-tests.yml`) runs on pushes to `main` and on PRs:

1. Installs dependencies
2. Starts the server
3. Waits for health check
4. Runs all Newman collections
5. Uploads HTML reports as artifacts

## Using in Postman GUI

1. Import `postman/environments/dev.postman_environment.json` as an environment.
2. Import each `*.collection.json` from `postman/collections/`.
3. Select the "ArenaX Development" environment.
4. Run requests or use the Collection Runner.
