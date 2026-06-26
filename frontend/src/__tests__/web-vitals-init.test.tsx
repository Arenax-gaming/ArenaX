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

import { WebVitalsInit } from '@/components/providers/WebVitalsInit';
import { defaultWebVitalsReporter } from '@/lib/webVitalsReporter';

describe('WebVitalsInit', () => {
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
