/**
 * Web Vitals reporter (#301).
 *
 * A tiny, dependency-free helper that buffers Web Vitals as they fire,
 * compares each metric against its acceptance budget, and ships a
 * batched report to an analytics endpoint configured via
 * NEXT_PUBLIC_ANALYTICS_ENDPOINT. Reporting is gated to production
 * (NODE_ENV === 'production') so development runs never send outbound
 * requests to the analytics pipeline.
 *
 * Why a custom reporter instead of `web-vitals` directly:
 *  - The repo doesn't ship `web-vitals` yet; we keep the helper
 *    independent so it can be wired up with `next/web-vitals` from the
 *    App-Router `reportWebVitals` hook, or with the `web-vitals` npm
 *    package once it's added.
 *  - We want explicit budget evaluation per the issue's perf targets
 *    (LCP ≤ 2500ms, FCP ≤ 1500ms, CLS ≤ 0.1, TTI ≤ 3000ms). The helper
 *    does that without pulling another dependency.
 */

export type WebVitalName = 'LCP' | 'FCP' | 'CLS' | 'TTI' | 'INP' | 'FID' | 'TTFB';

export type DeviceCategory = 'mobile' | 'desktop';

export interface WebVitalMetric {
    name: WebVitalName;
    value: number;
    id: string;
    label?: string;
    /** Route template (e.g. "/tournaments/[id]"), not the full URL — #1114. */
    route?: string;
    device?: DeviceCategory;
    /** `navigator.connection.effectiveType`, e.g. "4g" | "3g" | "slow-2g" (#1114). */
    connection?: string;
    /**
     * SHA-256 hash of the user id, already anonymised by the caller before
     * it reaches the reporter (#1114) — this module never sees or transmits
     * a raw user id.
     */
    userIdHash?: string;
}

export interface WebVitalReport extends WebVitalMetric {
    /** Whether this metric is within its budget. */
    withinBudget: boolean;
    /** The budget the metric was checked against (undefined if no budget exists). */
    budget?: number;
}

/**
 * Budgets aligned with the issue's "performance targets" section. Times
 * in milliseconds; CLS is unitless.
 */
export const WEB_VITAL_BUDGETS: Readonly<Record<WebVitalName, number>> = {
    LCP: 2500,
    FCP: 1500,
    CLS: 0.1,
    TTI: 3000,
    INP: 200,
    FID: 100,
    TTFB: 800,
};

/**
 * Evaluate whether a single metric meets its budget. Pure helper —
 * the reporter uses this internally; tests verify it independently.
 */
export const evaluateMetric = (metric: WebVitalMetric): WebVitalReport => {
    const budget = WEB_VITAL_BUDGETS[metric.name];
    if (budget == null) {
        return { ...metric, withinBudget: true };
    }
    return {
        ...metric,
        budget,
        withinBudget: metric.value <= budget,
    };
};

export interface WebVitalsReporterOptions {
    /** Endpoint to POST batched reports to. Defaults to NEXT_PUBLIC_ANALYTICS_ENDPOINT. */
    endpoint?: string;
    /** Max metrics to buffer before flushing (default 10). */
    bufferSize?: number;
    /** Flush interval in ms (default 5000). */
    flushIntervalMs?: number;
    /**
     * Optional fetcher override for tests. Defaults to the global
     * `fetch` when available.
     */
    fetcher?: typeof fetch;
    /** Optional sink override — bypasses fetch entirely if provided. */
    sink?: (reports: WebVitalReport[]) => void | Promise<void>;
}

export interface WebVitalsReporter {
    /** Record a metric. */
    record: (metric: WebVitalMetric) => void;
    /** Force-flush the buffer (e.g. on page-hide). */
    flush: () => Promise<void>;
    /** Drain and return the current buffer without flushing — test hook. */
    _drain: () => WebVitalReport[];
}

const noop = () => {};

// Read lazily so tests can flip NODE_ENV (Jest runs with `test`) to
// exercise the shipping paths; production behavior is unchanged.
const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Create a reporter. The factory style is the same we use for
 * `analytics.service.ts` on the backend — production gets a single
 * instance via `defaultWebVitalsReporter`; tests instantiate freely.
 */
export const createWebVitalsReporter = (
    options: WebVitalsReporterOptions = {}
): WebVitalsReporter => {
    // Defaults to the app's own route (#1114) rather than an empty string,
    // so reporting works out of the box without a separately-hosted
    // analytics collector; NEXT_PUBLIC_ANALYTICS_ENDPOINT can still point
    // it at Datadog or another collector instead.
    const endpoint =
        options.endpoint ?? process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT ?? '/api/analytics/web-vitals';
    const bufferSize = options.bufferSize ?? 10;
    const flushIntervalMs = options.flushIntervalMs ?? 5_000;
    const fetcher: typeof fetch =
        options.fetcher ??
        (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (noop as unknown as typeof fetch));

    let buffer: WebVitalReport[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const drain = (): WebVitalReport[] => {
        const reports = buffer;
        buffer = [];
        if (flushTimer != null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        return reports;
    };

    const ship = async (reports: WebVitalReport[]) => {
        if (reports.length === 0) return;
        // Never send metrics outside production to avoid polluting analytics.
        if (!isProduction()) return;
        if (options.sink) {
            await options.sink(reports);
            return;
        }
        // Gracefully skip if the endpoint is not configured in production.
        if (!endpoint) return;
        try {
            await fetcher(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    eventType: 'web_vitals',
                    data: { reports },
                }),
                // `keepalive` lets the request survive a page-hide on
                // modern browsers — critical for the flush-on-unload
                // path used to capture last-mile metrics.
                keepalive: true,
            } as RequestInit);
        } catch {
            // Drop the batch on transport error — vitals are best-
            // effort, and re-queueing risks an unbounded memory leak
            // if the endpoint is permanently down.
        }
    };

    const flush = async () => {
        const reports = drain();
        await ship(reports);
    };

    const scheduleFlush = () => {
        if (flushTimer != null) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            void flush();
        }, flushIntervalMs);
    };

    const record = (metric: WebVitalMetric) => {
        buffer.push(evaluateMetric(metric));
        if (buffer.length >= bufferSize) {
            void flush();
        } else {
            scheduleFlush();
        }
    };

    return { record, flush, _drain: drain };
};

/** Default reporter used by the production code path. */
export const defaultWebVitalsReporter = createWebVitalsReporter();

/**
 * SHA-256 hex digest of a user id (#1114) — Web Vitals reports carry this
 * instead of the raw id so a report can be attributed to "the same user
 * across page loads" for debugging without transmitting anything that
 * identifies them on its own. Returns undefined when the Web Crypto API
 * isn't available (very old browsers) rather than falling back to sending
 * the raw id.
 */
export async function hashUserId(userId: string): Promise<string | undefined> {
    if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
        return undefined;
    }
    const bytes = new TextEncoder().encode(userId);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
