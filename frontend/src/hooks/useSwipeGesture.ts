// filepath: frontend/src/hooks/useSwipeGesture.ts
"use client";

import { useCallback, useRef, useState } from "react";

type SwipeDirection = "left" | "right" | "up" | "down" | null;

interface SwipeOptions {
  threshold?: number;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  enabled?: boolean;
}

export function useSwipeGesture({
  threshold = 50,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
  enabled = true,
}: SwipeOptions) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const touchEnd = useRef<{ x: number; y: number } | null>(null);
  const [direction, setDirection] = useState<SwipeDirection>(null);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent | TouchEvent) => {
      if (!enabled) return;
      const touch = e instanceof TouchEvent ? e.touches[0] : e.touches[0];
      touchStart.current = { x: touch.clientX, y: touch.clientY };
      touchEnd.current = { x: touch.clientX, y: touch.clientY };
    },
    [enabled]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent | TouchEvent) => {
      if (!enabled || !touchStart.current) return;
      const touch = e instanceof TouchEvent ? e.touches[0] : e.touches[0];
      touchEnd.current = { x: touch.clientX, y: touch.clientY };
    },
    [enabled]
  );

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !touchStart.current || !touchEnd.current) return;

    const deltaX = touchEnd.current.x - touchStart.current.x;
    const deltaY = touchEnd.current.y - touchStart.current.y;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Determine if horizontal or vertical swipe
    if (absX > absY) {
      // Horizontal swipe
      if (absX > threshold) {
        if (deltaX > 0) {
          setDirection("right");
          onSwipeRight?.();
        } else {
          setDirection("left");
          onSwipeLeft?.();
        }
      }
    } else {
      // Vertical swipe
      if (absY > threshold) {
        if (deltaY > 0) {
          setDirection("down");
          onSwipeDown?.();
        } else {
          setDirection("up");
          onSwipeUp?.();
        }
      }
    }

    // Reset after a short delay
    setTimeout(() => setDirection(null), 300);
    touchStart.current = null;
    touchEnd.current = null;
  }, [enabled, threshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]);

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    direction,
  };
}

// Hook for detecting long press
export function useLongPress(callback: () => void, duration = 500) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isLongPress, setIsLongPress] = useState(false);

  const startLongPress = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      setIsLongPress(true);
      callback();
    }, duration);
  }, [callback, duration]);

  const cancelLongPress = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsLongPress(false);
  }, []);

  return {
    onTouchStart: startLongPress,
    onTouchEnd: cancelLongPress,
    onTouchMove: cancelLongPress,
    isLongPress,
  };
}

// Hook for detecting double tap
export function useDoubleTap(callback: () => void, delay = 300) {
  const lastTapRef = useRef<number>(0);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < delay) {
      callback();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  }, [callback, delay]);

  return handleTap;
}