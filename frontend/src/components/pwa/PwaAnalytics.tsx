"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

declare global {
  interface Window {
    __PWA_METRICS__?: {
      pageViews: number;
      installTime: string | null;
      online: boolean;
      serviceWorker: boolean;
    };
  }
}

export function PwaAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!window.__PWA_METRICS__) {
      window.__PWA_METRICS__ = {
        pageViews: 0,
        installTime: null,
        online: navigator.onLine,
        serviceWorker: "serviceWorker" in navigator,
      };
    }

    window.__PWA_METRICS__.pageViews++;
    window.__PWA_METRICS__.online = navigator.onLine;

    const handleOnline = () => {
      if (window.__PWA_METRICS__) window.__PWA_METRICS__.online = true;
    };
    const handleOffline = () => {
      if (window.__PWA_METRICS__) window.__PWA_METRICS__.online = false;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (window.matchMedia("(display-mode: standalone)").matches && !window.__PWA_METRICS__.installTime) {
      window.__PWA_METRICS__.installTime = new Date().toISOString();
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [pathname]);

  return null;
}
