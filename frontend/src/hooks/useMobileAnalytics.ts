// filepath: frontend/src/hooks/useMobileAnalytics.ts
"use client";

import { useEffect, useCallback, useRef } from "react";
import { useDevice, useOnlineStatus, useConnectionSpeed } from "./useMobile";

interface AnalyticsEvent {
  category: string;
  action: string;
  label?: string;
  value?: number;
}

interface ScreenView {
  screen_name: string;
  screen_path: string;
}

interface UserTiming {
  category: string;
  variable: string;
  value: number;
  label?: string;
}

interface Exception {
  description: string;
  fatal: boolean;
}

// Analytics configuration
const ANALYTICS_CONFIG = {
  // Sample rate for mobile (can be lower to reduce data)
  sampleRate: 100, // 100% on mobile
  // Minimum session duration before sending events
  minSessionDuration: 10000,
  // Maximum queue size before forcing flush
  maxQueueSize: 50,
  // Flush interval in milliseconds
  flushInterval: 30000,
};

class MobileAnalytics {
  private queue: AnalyticsEvent[] = [];
  private screenHistory: ScreenView[] = [];
  private sessionStart: number = 0;
  private isInitialized: boolean = false;
  private flushTimer: NodeJS.Timeout | null = null;

  // Initialize analytics
  init() {
    if (this.isInitialized) return;
    
    this.sessionStart = Date.now();
    this.isInitialized = true;
    
    // Start flush timer
    this.flushTimer = setInterval(() => {
      this.flush();
    }, ANALYTICS_CONFIG.flushInterval);
    
    console.log("[MobileAnalytics] Initialized");
  }

  // Track screen view
  trackScreenView(screenName: string, screenPath: string) {
    const screenView: ScreenView = {
      screen_name: screenName,
      screen_path: screenPath,
    };
    
    this.screenHistory.push(screenView);
    
    // In production, send to analytics service
    this.sendEvent({
      category: "screen_view",
      action: screenName,
      label: screenPath,
    });
    
    console.log("[MobileAnalytics] Screen view:", screenName);
  }

  // Track event
  trackEvent(event: AnalyticsEvent) {
    this.queue.push(event);
    
    // Flush if queue is full
    if (this.queue.length >= ANALYTICS_CONFIG.maxQueueSize) {
      this.flush();
    }
  }

  // Track user timing
  trackUserTiming(timing: UserTiming) {
    this.sendEvent({
      category: "timing",
      action: timing.variable,
      label: timing.label,
      value: timing.value,
    });
  }

  // Track exception
  trackException(exception: Exception) {
    this.sendEvent({
      category: "exception",
      action: exception.description,
      label: exception.fatal ? "fatal" : "non-fatal",
    });
  }

  // Track mobile-specific events
  trackMobileEvent(action: string, label?: string, value?: number) {
    this.trackEvent({
      category: "mobile",
      action,
      label,
      value,
    });
  }

  // Send event to analytics service
  private sendEvent(event: AnalyticsEvent) {
    // In production, replace with actual analytics service call
    // Example: gtag, Mixpanel, Amplitude, etc.
    console.log("[MobileAnalytics] Event:", event);
    
    // Example implementation:
    // if (typeof window !== 'undefined' && (window as any).gtag) {
    //   (window as any).gtag('event', event.action, {
    //     event_category: event.category,
    //     event_label: event.label,
    //     value: event.value,
    //   });
    // }
  }

  // Flush queue
  private flush() {
    if (this.queue.length === 0) return;
    
    // Send all events
    this.queue.forEach((event) => this.sendEvent(event));
    this.queue = [];
    
    console.log("[MobileAnalytics] Flushed events");
  }

  // End session
  endSession() {
    const sessionDuration = Date.now() - this.sessionStart;
    
    if (sessionDuration >= ANALYTICS_CONFIG.minSessionDuration) {
      this.trackEvent({
        category: "session",
        action: "end",
        value: sessionDuration,
      });
    }
    
    this.flush();
    
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }

  // Get screen history
  getScreenHistory() {
    return [...this.screenHistory];
  }
}

// Create singleton instance
const analytics = new MobileAnalytics();

// React hook for using analytics
export function useMobileAnalytics() {
  const device = useDevice();
  const isOnline = useOnlineStatus();
  const connectionSpeed = useConnectionSpeed();
  const isInitialized = useRef(false);

  // Initialize on mount
  useEffect(() => {
    if (!isInitialized.current) {
      analytics.init();
      isInitialized.current = true;
    }
    
    // Track device info
    analytics.trackMobileEvent("device_info", `${device.deviceType}`, undefined);
    
    // Track connection speed
    analytics.trackMobileEvent("connection", connectionSpeed, undefined);
    
    // Track online status
    if (!isOnline) {
      analytics.trackMobileEvent("offline", "connection_lost");
    }
    
    return () => {
      analytics.endSession();
    };
  }, []);

  // Track screen view
  const trackScreen = useCallback((screenName: string, screenPath: string) => {
    analytics.trackScreenView(screenName, screenPath);
  }, []);

  // Track custom event
  const trackEvent = useCallback(
    (action: string, label?: string, value?: number) => {
      if (!isOnline) {
        console.log("[MobileAnalytics] Offline - event queued");
      }
      analytics.trackMobileEvent(action, label, value);
    },
    [isOnline]
  );

  // Track timing
  const trackTiming = useCallback(
    (category: string, variable: string, value: number, label?: string) => {
      analytics.trackUserTiming({ category, variable, value, label });
    },
    []
  );

  // Track error
  const trackError = useCallback(
    (description: string, fatal = false) => {
      analytics.trackException({ description, fatal });
    },
    []
  );

  // Track touch interaction
  const trackTouch = useCallback(
    (element: string, action: string) => {
      analytics.trackMobileEvent("touch", `${element}_${action}`);
    },
    []
  );

  // Track gesture
  const trackGesture = useCallback(
    (gesture: string, direction?: string) => {
      analytics.trackMobileEvent("gesture", direction ? `${gesture}_${direction}` : gesture);
    },
    []
  );

  // Track performance
  const trackPerformance = useCallback(
    (metric: string, value: number) => {
      analytics.trackTiming("performance", metric, value);
    },
    []
  );

  return {
    trackScreen,
    trackEvent,
    trackTiming,
    trackError,
    trackTouch,
    trackGesture,
    trackPerformance,
    deviceType: device.deviceType,
    isOnline,
    connectionSpeed,
  };
}

export default useMobileAnalytics;