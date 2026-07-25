"use client";

import { useEffect } from "react";
import { datadogRum } from "@datadog/browser-rum";
import { useConsentStore } from "@/hooks/useConsentStore";

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE_PATTERN = /\+?\d[\d\s\-().]{7,}\d/g;

function redactPii(value: string): string {
    return value.replace(EMAIL_PATTERN, "[REDACTED]").replace(PHONE_PATTERN, "[REDACTED]");
}

function redactContext(value: unknown, seen = new WeakSet<object>()): unknown {
    if (typeof value === "string") {
        return redactPii(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactContext(item, seen));
    }

    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if (seen.has(obj)) return value;
        seen.add(obj);

        const result: Record<string, unknown> = {};
        for (const key of Object.keys(obj)) {
            result[key] = redactContext(obj[key], seen);
        }
        return result;
    }

    return value;
}

// Fallback flag in case the installed @datadog/browser-rum version doesn't
// expose getInitConfiguration().
let rumInitialized = false;

function isRumInitialized(): boolean {
    if (typeof datadogRum.getInitConfiguration === "function") {
        return Boolean(datadogRum.getInitConfiguration());
    }
    return rumInitialized;
}

export function RumProvider({ children }: { children: React.ReactNode }) {
    const { hasAnalyticsConsent } = useConsentStore();

    useEffect(() => {
        if (hasAnalyticsConsent) {
            if (isRumInitialized()) return;

            datadogRum.init({
                applicationId: process.env.NEXT_PUBLIC_DATADOG_APP_ID || 'dummy-app-id',
                clientToken: process.env.NEXT_PUBLIC_DATADOG_CLIENT_TOKEN || 'dummy-client-token',
                site: 'datadoghq.com',
                service: 'arenax-frontend',
                env: process.env.NODE_ENV,
                version: '1.0.0',
                sessionSampleRate: 100,
                sessionReplaySampleRate: 20,
                trackUserInteractions: true,
                trackResources: true,
                trackLongTasks: true,
                defaultPrivacyLevel: 'mask-user-input',
                beforeSend: (event) => {
                    if (event.view?.url) {
                        event.view.url = redactPii(event.view.url);
                    }
                    if (event.context) {
                        event.context = redactContext(event.context) as typeof event.context;
                    }
                    return true;
                },
            });
            rumInitialized = true;
        } else if (isRumInitialized()) {
            // Consent revoked (or never granted) — stop tracking and clear any
            // identified user so no further data is collected/associated.
            datadogRum.stopSession();
            datadogRum.clearUser();
            rumInitialized = false;
        }
    }, [hasAnalyticsConsent]);

    return <>{children}</>;
}
