import { InMemoryApiVersionRegistry } from '../middleware/api-version.middleware';

/**
 * Single source of truth for which API versions exist and their status.
 * Consumed by `apiVersionMiddleware` (deprecation/sunset headers) and the
 * `GET /api/versions` discovery endpoint.
 */
export const apiVersionRegistry = new InMemoryApiVersionRegistry();

apiVersionRegistry.register(
    {
        name: 'v1',
        status: 'live',
        introducedAt: '2026-02-19T00:00:00.000Z',
    },
    { default: true },
);
