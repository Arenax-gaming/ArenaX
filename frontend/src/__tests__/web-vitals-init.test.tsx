/**
 * Tests for WebVitalsInit (#526).
 */
import React from 'react';
import { render, act } from '@testing-library/react';

// Spy on defaultWebVitalsReporter before the module under test is imported.
jest.mock('@/lib/webVitalsReporter', () => {
  const flush = jest.fn().mockResolvedValue(undefined);
  const record = jest.fn();
  const _drain = jest.fn().mockReturnValue([]);
  return {
    defaultWebVitalsReporter: { flush, record, _drain },
    createWebVitalsReporter: jest.fn(),
    evaluateMetric: jest.fn(),
    WEB_VITAL_BUDGETS: {},
    hashUserId: jest.fn().mockResolvedValue('hashed-user-id'),
  };
});

// web-vitals mock — simulate successful import
jest.mock('web-vitals', () => ({
  onCLS: jest.fn(),
  onFCP: jest.fn(),
  onLCP: jest.fn(),
  onTTFB: jest.fn(),
  onINP: jest.fn(),
}), { virtual: true });

// WebVitalsInit reads the route and (optional) signed-in user to enrich
// reports with route/device/connection/userIdHash (#1114).
jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

let mockUser: { id: string } | null = null;
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser }),
}));

import * as webVitalsLib from 'web-vitals';
import { WebVitalsInit } from '@/components/providers/WebVitalsInit';
import { defaultWebVitalsReporter, hashUserId } from '@/lib/webVitalsReporter';

describe('WebVitalsInit', () => {
  // WebVitalsInit only wires up listeners in production (Jest runs with
  // NODE_ENV=test), so flip the env for the whole suite.
  beforeAll(() => {
    process.env.NODE_ENV = 'production';
  });

  afterAll(() => {
    process.env.NODE_ENV = 'test';
  });

  beforeEach(() => {
    mockUser = null;
    (defaultWebVitalsReporter.record as jest.Mock).mockClear();
    (webVitalsLib.onLCP as jest.Mock).mockClear();
  });

  it('enriches a reported metric with route, device, and connection (#1114)', async () => {
    render(<WebVitalsInit />);
    await act(async () => {
      await Promise.resolve();
    });

    const record = (webVitalsLib.onLCP as jest.Mock).mock.calls[0][0] as (m: unknown) => void;
    act(() => {
      record({ name: 'LCP', value: 1200, id: 'v1' });
    });

    expect(defaultWebVitalsReporter.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'LCP', value: 1200, route: '/dashboard' }),
    );
  });

  it('attaches a hashed user id (never the raw id) when signed in (#1114)', async () => {
    mockUser = { id: 'user-42' };
    render(<WebVitalsInit />);
    await act(async () => {
      await Promise.resolve();
    });

    const record = (webVitalsLib.onLCP as jest.Mock).mock.calls[0][0] as (m: unknown) => void;
    await act(async () => {
      record({ name: 'LCP', value: 1200, id: 'v1' });
      await Promise.resolve();
    });

    expect(hashUserId).toHaveBeenCalledWith('user-42');
    expect(defaultWebVitalsReporter.record).toHaveBeenCalledWith(
      expect.objectContaining({ userIdHash: 'hashed-user-id' }),
    );
    // The raw user id must never reach the reporter — only its hash (#1114).
    const reportedArgs = (defaultWebVitalsReporter.record as jest.Mock).mock.calls.map((c) => c[0]);
    expect(JSON.stringify(reportedArgs)).not.toContain('user-42');
  });

  it('renders nothing to the DOM', () => {
    const { container } = render(<WebVitalsInit />);
    expect(container.firstChild).toBeNull();
  });

  it('flushes reporter on visibilitychange to hidden', async () => {
    render(<WebVitalsInit />);

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(defaultWebVitalsReporter.flush).toHaveBeenCalled();
  });

  it('does not flush reporter when visibility changes to visible', async () => {
    (defaultWebVitalsReporter.flush as jest.Mock).mockClear();
    render(<WebVitalsInit />);

    await act(async () => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(defaultWebVitalsReporter.flush).not.toHaveBeenCalled();
  });
});
