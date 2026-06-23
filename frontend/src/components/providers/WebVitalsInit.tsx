'use client';

import { useEffect } from 'react';
import { defaultWebVitalsReporter } from '@/lib/webVitalsReporter';
import type { WebVitalMetric } from '@/lib/webVitalsReporter';

/**
 * Client component that wires the web vitals reporter into the
 * Next.js App Router. Mount once in the root layout.
 *
 * The `web-vitals` npm package is loaded lazily so it doesn't bloat
 * the main bundle. When `web-vitals` is not installed the component is
 * a no-op, which keeps the server-render path safe.
 */
export function WebVitalsInit() {
  useEffect(() => {
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
