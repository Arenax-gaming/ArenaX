/**
 * correlation.service.ts
 *
 * Async-context store for request correlation IDs.
 *
 * AsyncLocalStorage propagates the store automatically through every
 * `await`, callback, and Promise continuation that runs within the
 * same async context — no manual variable passing required.
 *
 * Usage:
 *   - Middleware: `correlationStore.run({ correlationId }, next)`
 *   - Anywhere:  `getCorrelationId()` → returns the active ID or undefined
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationContext {
    correlationId: string;
}

export const correlationStore = new AsyncLocalStorage<CorrelationContext>();

/** Returns the active correlation ID, or undefined outside a request context. */
export const getCorrelationId = (): string | undefined =>
    correlationStore.getStore()?.correlationId;
