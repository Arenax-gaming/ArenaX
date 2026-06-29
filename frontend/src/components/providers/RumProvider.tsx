"use client";

import { useEffect } from "react";
import { datadogRum } from "@datadog/browser-rum";

export function RumProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
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
        });
    }, []);

    return <>{children}</>;
}
