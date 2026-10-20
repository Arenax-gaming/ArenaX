/**
 * Shared OpenAPI configuration (Issue #1404).
 *
 * The spec is generated from `@openapi` JSDoc annotations on every route in
 * `src/routes/`. Both the running server (`src/openapi/swagger.ts`) and the
 * generator/CI check (`scripts/openapi.js`) build the spec through
 * `buildSpec()`, so the committed `openapi.json` and the served spec can't
 * drift apart.
 */
const path = require('path');
const fs = require('fs');
const swaggerJsdoc = require('swagger-jsdoc');

const definition = {
  openapi: '3.0.0',
  info: {
    title: 'ArenaX API',
    version: '1.0.0',
    description: `
ArenaX Gaming Platform API — comprehensive endpoints for match management,
tournaments, user profiles, wallets, governance, and blockchain interactions.

## Authentication
Most endpoints require a Bearer JWT token in the Authorization header.
\`\`\`
Authorization: Bearer <token>
\`\`\`

## Rate Limiting
API requests are rate-limited using Token Bucket algorithm. Limits vary by endpoint type:
- Auth endpoints: 5 req/min
- Payment endpoints: 10 req/min
- Game actions: 30 req/min
- General API: 100 req/min

Rate limit headers are returned with every response.
    `,
    contact: {
      name: 'ArenaX Support',
      url: 'https://arenax.gg/support',
      email: 'support@arenax.gg',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:3001/api',
      description: 'Development server',
    },
    {
      url: 'https://api.arenax.gg/api',
      description: 'Production server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token',
      },
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'API key for public endpoints',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          code: { type: 'string' },
        },
      },
      RateLimitError: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Rate limit exceeded' },
          code: { type: 'string', example: 'TOKEN_BUCKET_RATE_LIMIT' },
          retryAfter: { type: 'integer', example: 12 },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Auth', description: 'Authentication endpoints' },
    { name: 'Users', description: 'User profile management' },
    { name: 'Matches', description: 'Match operations' },
    { name: 'Tournaments', description: 'Tournament management' },
    { name: 'Wallet', description: 'Wallet and payment operations' },
    { name: 'Governance', description: 'DAO governance proposals' },
    { name: 'Admin', description: 'Admin-only operations' },
    { name: 'Leaderboard', description: 'Leaderboard queries' },
    { name: 'Health', description: 'Health check endpoints' },
    { name: 'Achievements', description: 'Achievement tracking' },
    { name: 'Analytics', description: 'Engagement analytics' },
    { name: 'Anchor', description: 'Stellar anchors' },
    { name: 'ApiGateway', description: 'API gateway and key management' },
    { name: 'AccessControl', description: 'Roles, permissions and delegation' },
    { name: 'Cache', description: 'CDN and cache management' },
    { name: 'CrossGameAsset', description: 'Cross-game asset bridge' },
    { name: 'Currency', description: 'Multi-currency catalogue and conversion' },
    { name: 'Dashboard', description: 'Operational dashboard' },
    { name: 'FeatureFlag', description: 'Feature flags' },
    { name: 'I18n', description: 'Localisation' },
    { name: 'Metrics', description: 'Prometheus metrics' },
    { name: 'PaymentWebhook', description: 'Payment provider webhooks' },
    { name: 'QueryAnalytics', description: 'Database query diagnostics' },
    { name: 'Queue', description: 'Job queue monitoring' },
    { name: 'Search', description: 'Search' },
    { name: 'Soroban', description: 'Soroban smart-contract calls' },
  ],
};

const apis = [path.join(__dirname, 'src/routes/*.ts')];
const specPath = path.join(__dirname, 'openapi.json');

/** Recursively sort object keys so serialisation is deterministic. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function generateSpec() {
  return sortKeys(swaggerJsdoc({ definition, apis, failOnErrors: true }));
}

/**
 * Build the spec from source annotations when they are available (dev), or
 * fall back to the committed `openapi.json` (e.g. a compiled deployment
 * without `src/`).
 */
function buildSpec() {
  const spec = generateSpec();
  if (Object.keys(spec.paths || {}).length > 0 || !fs.existsSync(specPath)) return spec;
  return JSON.parse(fs.readFileSync(specPath, 'utf8'));
}

module.exports = { definition, apis, specPath, generateSpec, buildSpec };
