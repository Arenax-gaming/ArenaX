'use client';

import { useEffect } from 'react';
import { defaultWebVitalsReporter } from '@/lib/webVitalsReporter';
import type { WebVitalMetric } from '@/lib/webVitalsReporter';

/**
 * Client component that wires the web vitals reporter into the
 * Next.js App Router. Mount once in the root layout.
 *
 * Reporting is restricted to production (NODE_ENV === 'production').
 * In development, a console warning is emitted when
 * NEXT_PUBLIC_ANALYTICS_ENDPOINT is not configured so that the
 * absence of reporting is explicit rather than silent.
 *
 * The `web-vitals` npm package is loaded lazily so it doesn't bloat
 * the main bundle. When `web-vitals` is not installed the component is
 * a no-op, which keeps the server-render path safe.
 */
export function WebVitalsInit() {
  useEffect(() => {
    const isProduction = process.env.NODE_ENV === 'production';
    const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;

    if (!isProduction) {
      if (!endpoint) {
        console.warn(
          '[WebVitals] Core Web Vitals reporting is disabled: ' +
          'NEXT_PUBLIC_ANALYTICS_ENDPOINT is not set.'
        );
      }
      return;
    }

    let cancelled = false;

    import('web-vitals').then(({ onCLS, onFCP, onLCP, onTTFB, onINP }) => {
      if (cancelled) return;

      const record = (m: WebVitalMetric) => defaultWebVitalsReporter.record(m);

      onCLS(record);
      onFCP(record);
      onLCP(record);
      onTTFB(record);
      onINP(record);
    }).catch(() => {
      // web-vitals not installed — silently no-op
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void defaultWebVitalsReporter.flush();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return null;
}
