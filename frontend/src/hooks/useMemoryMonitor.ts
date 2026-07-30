/**
 * useMemoryMonitor — Development-only memory monitoring hook
 *
 * Provides memory usage monitoring in development environments to help
 * detect memory leaks and track memory patterns during component lifecycle.
 *
 * Only active in development mode (NODE_ENV === 'development').
 * Does nothing in production builds.
 */

"use client";

import { useEffect, useRef, useState } from "react";

export interface MemoryInfo {
  /** Current memory usage in bytes */
  usedJSHeapSize: number;
  /** Total allocated heap size in bytes */
  totalJSHeapSize: number;
  /** Hard limit of heap size in bytes */
  jsHeapSizeLimit: number;
  /** Memory usage as percentage of limit */
  usagePercentage: number;
}

export interface MemoryMonitorOptions {
  /** Polling interval in milliseconds (default: 5000) */
  interval?: number;
  /** Callback called when memory usage exceeds threshold (0-1) */
  onThresholdExceeded?: (info: MemoryInfo) => void;
  /** Threshold as percentage (0-1) to trigger warning (default: 0.8) */
  threshold?: number;
  /** Enable console logging of memory stats (default: true) */
  enableLogging?: boolean;
}

export function useMemoryMonitor({
  interval = 5000,
  onThresholdExceeded,
  threshold = 0.8,
  enableLogging = true,
}: MemoryMonitorOptions = {}) {
  const [memoryInfo, setMemoryInfo] = useState<MemoryInfo | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousUsageRef = useRef<number>(0);

  useEffect(() => {
    // Only run in development
    if (process.env.NODE_ENV !== "development") {
      return;
    }

    // Check if performance.memory is available (Chrome-based browsers)
    if (typeof performance === "undefined" || !(performance as any).memory) {
      if (enableLogging) {
        console.warn(
          "[useMemoryMonitor] performance.memory API not available. Memory monitoring disabled."
        );
      }
      return;
    }

    const memory = (performance as any).memory;

    const updateMemoryInfo = () => {
      const info: MemoryInfo = {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
        usagePercentage: memory.usedJSHeapSize / memory.jsHeapSizeLimit,
      };

      setMemoryInfo(info);

      // Log memory usage if enabled
      if (enableLogging) {
        const usedMB = (info.usedJSHeapSize / 1048576).toFixed(2);
        const limitMB = (info.jsHeapSizeLimit / 1048576).toFixed(2);
        const percent = (info.usagePercentage * 100).toFixed(2);

        console.log(
          `[useMemoryMonitor] Memory: ${usedMB}MB / ${limitMB}MB (${percent}%)`
        );

        // Detect memory leaks by comparing with previous usage
        if (previousUsageRef.current > 0) {
          const diff = info.usedJSHeapSize - previousUsageRef.current;
          const diffMB = (diff / 1048576).toFixed(2);
          if (diff > 1048576) {
            // More than 1MB increase
            console.warn(
              `[useMemoryMonitor] Memory increased by ${diffMB}MB since last check`
            );
          }
        }
        previousUsageRef.current = info.usedJSHeapSize;
      }

      // Check threshold
      if (info.usagePercentage > threshold) {
        console.error(
          `[useMemoryMonitor] Memory usage exceeded threshold: ${(info.usagePercentage * 100).toFixed(2)}%`
        );
        onThresholdExceeded?.(info);
      }
    };

    // Initial check
    updateMemoryInfo();
    setIsMonitoring(true);

    // Set up polling
    intervalRef.current = setInterval(updateMemoryInfo, interval);

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setIsMonitoring(false);
    };
  }, [interval, onThresholdExceeded, threshold, enableLogging]);

  return {
    memoryInfo,
    isMonitoring,
    /** Manually trigger a memory check */
    checkMemory: () => {
      if (typeof performance !== "undefined" && (performance as any).memory) {
        const memory = (performance as any).memory;
        const info: MemoryInfo = {
          usedJSHeapSize: memory.usedJSHeapSize,
          totalJSHeapSize: memory.totalJSHeapSize,
          jsHeapSizeLimit: memory.jsHeapSizeLimit,
          usagePercentage: memory.usedJSHeapSize / memory.jsHeapSizeLimit,
        };
        setMemoryInfo(info);
        return info;
      }
      return null;
    },
  };
}

/**
 * Hook to detect potential memory leaks by tracking component mount/unmount cycles
 */
export function useMemoryLeakDetector(componentName: string) {
  const mountCountRef = useRef(0);
  const mountTimesRef = useRef<number[]>([]);

  useEffect(() => {
    mountCountRef.current += 1;
    const mountTime = Date.now();
    mountTimesRef.current.push(mountTime);

    if (process.env.NODE_ENV === "development") {
      console.log(
        `[MemoryLeakDetector] ${componentName} mounted (count: ${mountCountRef.current})`
      );

      // Warn if component has been mounted more than 10 times
      if (mountCountRef.current > 10) {
        console.warn(
          `[MemoryLeakDetector] ${componentName} has been mounted ${mountCountRef.current} times. Possible memory leak?`
        );
      }

      // Keep only last 20 mount times
      if (mountTimesRef.current.length > 20) {
        mountTimesRef.current = mountTimesRef.current.slice(-20);
      }
    }

    return () => {
      if (process.env.NODE_ENV === "development") {
        const unmountTime = Date.now();
        const mountDuration = unmountTime - mountTime;
        console.log(
          `[MemoryLeakDetector] ${componentName} unmounted (lived for ${mountDuration}ms)`
        );
      }
    };
  }, [componentName]);

  return {
    mountCount: mountCountRef.current,
    averageMountTime:
      mountTimesRef.current.length > 0
        ? mountTimesRef.current.reduce((a, b) => a + b, 0) / mountTimesRef.current.length
        : 0,
  };
}
