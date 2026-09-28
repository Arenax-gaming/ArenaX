'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { defaultWebVitalsReporter, hashUserId } from '@/lib/webVitalsReporter';
import type { DeviceCategory, WebVitalMetric } from '@/lib/webVitalsReporter';
import { useAuth } from '@/hooks/useAuth';

interface NavigatorConnection {
  effectiveType?: string;
}

function getDeviceCategory(): DeviceCategory {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'desktop';
  }
  return window.matchMedia('(max-width: 768px)').matches ? 'mobile' : 'desktop';
}

function getConnectionType(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const nav = navigator as Navigator & { connection?: NavigatorConnection };
  return nav.connection?.effectiveType;
}

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
 *
 * Each report carries the route template (this pathname — App Router
 * doesn't expose the unfilled `[id]`-style template client-side, so the
 * resolved path is the closest available proxy), device category,
 * connection type, and a SHA-256 hash of the user id rather than the id
 * itself (#1114) — no PII crosses the wire.
 */
export function WebVitalsInit() {
  const pathname = usePathname();
  const { user } = useAuth();

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

    // Web Vitals are non-essential telemetry — require "performance"
    // consent before loading web-vitals or reporting anything (#1093).
    if (!hasConsentedTo('performance')) {
      return;
    }

    let cancelled = false;

    import('web-vitals').then(({ onCLS, onFCP, onLCP, onTTFB, onINP }) => {
      if (cancelled) return;

      const device = getDeviceCategory();
      const connection = getConnectionType();

      const record = (m: WebVitalMetric) => {
        const enriched: WebVitalMetric = { ...m, route: pathname, device, connection };
        if (user?.id) {
          hashUserId(user.id).then((userIdHash) => {
            defaultWebVitalsReporter.record({ ...enriched, userIdHash });
          });
        } else {
          defaultWebVitalsReporter.record(enriched);
        }
      };

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
  }, [pathname, user?.id]);

  return null;
}
