// filepath: frontend/src/hooks/useMobile.ts
"use client";

import { useState, useEffect, useCallback } from "react";

export type DeviceType = "mobile" | "tablet" | "desktop";

interface ViewportSize {
  width: number;
  height: number;
}

interface UseDeviceReturn {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  deviceType: DeviceType;
  viewport: ViewportSize;
  isPortrait: boolean;
  isLandscape: boolean;
  isTouchDevice: boolean;
  hasNotch: boolean;
  safeAreaInsets: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

// Breakpoints matching Tailwind config
const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
};

export function useDevice(): UseDeviceReturn {
  const [viewport, setViewport] = useState<ViewportSize>({
    width: typeof window !== "undefined" ? window.innerWidth : 0,
    height: typeof window !== "undefined" ? window.innerHeight : 0,
  });

  const [deviceType, setDeviceType] = useState<DeviceType>("desktop");
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [hasNotch, setHasNotch] = useState(false);

  const updateViewport = useCallback(() => {
    if (typeof window === "undefined") return;
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    setViewport({ width, height });
    
    // Determine device type
    if (width < BREAKPOINTS.md) {
      setDeviceType("mobile");
    } else if (width < BREAKPOINTS.lg) {
      setDeviceType("tablet");
    } else {
      setDeviceType("desktop");
    }
    
    // Check for touch device
    setIsTouchDevice(
      "ontouchstart" in window || 
      navigator.maxTouchPoints > 0 ||
      window.matchMedia("(pointer: coarse)").matches
    );
    
    // Check for notch (iPhone X and newer)
    setHasNotch(
      // iPhone X, XS, XR, 11, 12, 13, 14, 15 series
      (window.screen.height === 844 && window.screen.width === 390) ||
      (window.screen.height === 896 && window.screen.width === 414) ||
      (window.screen.height === 852 && window.screen.width === 393) ||
      (window.screen.height === 844 && window.screen.width === 391) ||
      (window.screen.height === 932 && window.screen.width === 430) ||
      (window.screen.height === 852 && window.screen.width === 393) ||
      // Plus other notch sizes
      (window.innerHeight === 844 && window.innerWidth === 390) ||
      (window.innerHeight === 896 && window.innerWidth === 414)
    );
  }, []);

  useEffect(() => {
    updateViewport();
    
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    
    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
    };
  }, [updateViewport]);

  // Calculate safe area insets using CSS
  const safeAreaInsets = {
    top: typeof window !== "undefined" 
      ? parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sat") || "0")
      : 0,
    right: typeof window !== "undefined"
      ? parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sar") || "0")
      : 0,
    bottom: typeof window !== "undefined"
      ? parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sab") || "0")
      : 0,
    left: typeof window !== "undefined"
      ? parseInt(getComputedStyle(document.documentElement).getPropertyValue("--sal") || "0")
      : 0,
  };

  return {
    isMobile: deviceType === "mobile",
    isTablet: deviceType === "tablet",
    isDesktop: deviceType === "desktop",
    deviceType,
    viewport,
    isPortrait: viewport.height > viewport.width,
    isLandscape: viewport.width > viewport.height,
    isTouchDevice,
    hasNotch,
    safeAreaInsets,
  };
}

// Hook for online/offline status
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    
    setIsOnline(navigator.onLine);
    
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}

// Hook for connection quality (approximation)
export function useConnectionSpeed() {
  const [speed, setSpeed] = useState<"slow" | "fast">("fast");

  useEffect(() => {
    if (typeof window === "undefined") return;
    
    // Check if connection is save-data mode or slow
    const connection = (navigator as any).connection;
    
    if (connection) {
      const checkConnection = () => {
        const effectiveType = connection.effectiveType;
        if (effectiveType === "slow-2g" || effectiveType === "2g") {
          setSpeed("slow");
        } else {
          setSpeed("fast");
        }
      };
      
      checkConnection();
      connection.addEventListener("change", checkConnection);
      
      return () => connection.removeEventListener("change", checkConnection);
    }
    
    // Default to fast if API not available
    setSpeed("fast");
  }, []);

  return speed;
}

// Hook for vibration feedback
export function useVibration() {
  const vibrate = useCallback((pattern: number | number[] = 10) => {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }, []);

  return { vibrate };
}