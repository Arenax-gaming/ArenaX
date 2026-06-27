/**
 * http-client.service.ts
 *
 * Thin wrapper around the native `fetch` API that automatically injects
 * the active `X-Correlation-ID` header on every outbound HTTP request.
 *
 * Usage (drop-in replacement for `fetch`):
 *   import { correlatedFetch } from '../services/http-client.service';
 *   const res = await correlatedFetch('https://api.example.com/data');
 *
 * Existing call-sites can pass their own `X-Correlation-ID` in `init`
 * and it will be used as-is (no override).
 */

import { getCorrelationId } from './correlation.service';

export const correlatedFetch: typeof fetch = (input, init) => {
    const correlationId = getCorrelationId();
    if (!correlationId) return fetch(input, init);

    const headers = new Headers(init?.headers);
    if (!headers.has('X-Correlation-ID')) {
        headers.set('X-Correlation-ID', correlationId);
    }

    return fetch(input, { ...init, headers });
};
