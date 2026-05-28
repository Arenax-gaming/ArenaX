/**
 * Tests for #301 web-vitals reporter + the pure metric-evaluation helper.
 * Adds to #302 testing coverage as well.
 */

import {
  createWebVitalsReporter,
  evaluateMetric,
  WEB_VITAL_BUDGETS,
  WebVitalMetric,
} from '@/lib/webVitalsReporter';

describe('evaluateMetric', () => {
  it('flags metrics that beat their budget as within-budget', () => {
    expect(
      evaluateMetric({ name: 'LCP', value: 2000, id: 'v1' }).withinBudget
    ).toBe(true);
    expect(
      evaluateMetric({ name: 'FCP', value: 1499, id: 'v2' }).withinBudget
    ).toBe(true);
    expect(
      evaluateMetric({ name: 'CLS', value: 0.05, id: 'v3' }).withinBudget
    ).toBe(true);
  });

  it('flags metrics that exceed their budget', () => {
    const r = evaluateMetric({ name: 'LCP', value: 3500, id: 'v4' });
    expect(r.withinBudget).toBe(false);
    expect(r.budget).toBe(WEB_VITAL_BUDGETS.LCP);
  });

  it('treats the budget boundary as within-budget (≤)', () => {
    expect(
      evaluateMetric({ name: 'TTI', value: WEB_VITAL_BUDGETS.TTI, id: 'v5' })
        .withinBudget
    ).toBe(true);
  });
});

describe('createWebVitalsReporter', () => {
  const metric = (overrides: Partial<WebVitalMetric> = {}): WebVitalMetric => ({
    name: 'LCP',
    value: 1000,
    id: 'm-' + Math.random().toString(36).slice(2),
    ...overrides,
  });

  it('flushes immediately when the buffer reaches bufferSize', async () => {
    const sink = jest.fn().mockResolvedValue(undefined);
    const reporter = createWebVitalsReporter({ bufferSize: 2, sink });
    reporter.record(metric({ value: 1200 }));
    expect(sink).not.toHaveBeenCalled();
    reporter.record(metric({ value: 1400 }));
    // Buffer hit threshold → flush is scheduled synchronously.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(sink).toHaveBeenCalledTimes(1);
    const reports = sink.mock.calls[0][0];
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({
      name: 'LCP',
      withinBudget: true,
    });
  });

  it('flushes on demand even when the buffer is below threshold', async () => {
    const sink = jest.fn().mockResolvedValue(undefined);
    const reporter = createWebVitalsReporter({ bufferSize: 10, sink });
    reporter.record(metric({ value: 1100 }));
    expect(sink).not.toHaveBeenCalled();
    await reporter.flush();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toHaveLength(1);
  });

  it('drains the buffer atomically — a second flush sees nothing', async () => {
    const sink = jest.fn().mockResolvedValue(undefined);
    const reporter = createWebVitalsReporter({ bufferSize: 10, sink });
    reporter.record(metric({ value: 900 }));
    await reporter.flush();
    expect(sink).toHaveBeenCalledTimes(1);
    await reporter.flush();
    // Second flush had nothing to ship.
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('falls back to fetch when no sink is provided', async () => {
    const fetcher = jest.fn().mockResolvedValue(undefined as unknown);
    const reporter = createWebVitalsReporter({
      endpoint: '/api/v1/analytics/events',
      bufferSize: 1,
      fetcher: fetcher as unknown as typeof fetch,
    });
    reporter.record(metric({ value: 1200 }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('/api/v1/analytics/events');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.eventType).toBe('web_vitals');
    expect(body.data.reports).toHaveLength(1);
  });

  it('swallows fetch errors so a flaky endpoint cannot crash the app', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('network down'));
    const reporter = createWebVitalsReporter({
      bufferSize: 1,
      fetcher: fetcher as unknown as typeof fetch,
    });
    expect(() => reporter.record(metric())).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetcher).toHaveBeenCalled();
  });
});
