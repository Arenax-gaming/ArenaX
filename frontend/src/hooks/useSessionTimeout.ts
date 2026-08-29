"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useInterval } from "@/hooks/useInterval";
import { useAuth } from "@/hooks/useAuth";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Session duration in seconds (2 hours) */
export const SESSION_DURATION_SECONDS = 2 * 60 * 60;

/** Warning time before session expiry in seconds (5 minutes) */
export const WARNING_TIME_SECONDS = 5 * 60;

/** Grace period after warning to extend session in seconds */
export const GRACE_PERIOD_SECONDS = 2 * 60;

/** Heartbeat interval for checking session status in milliseconds */
export const CHECK_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionTimeoutState {
  isWarning: boolean;
  timeRemaining: number;
  isExpired: boolean;
}

interface UseSessionTimeoutReturn {
  /** Current session timeout state */
  state: SessionTimeoutState;
  
  /** Show the warning modal */
  showWarning: boolean;
  
  /** Time remaining until session expires (in seconds) */
  timeRemaining: number;
  
  /** Extend session by another duration */
  extendSession: () => Promise<void>;
  
  /** Force logout now */
  forceLogout: () => void;
  
  /** Reset the session timer */
  resetTimer: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSessionTimeout(): UseSessionTimeoutReturn {
  const router = useRouter();
  const { user, refreshAccessToken, logout } = useAuth();
  
  const [isWarning, setIsWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(SESSION_DURATION_SECONDS);
  const [isExpired, setIsExpired] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const warningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Track activity
  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    
    // Clear warning if user is active
    if (isWarning) {
      setIsWarning(false);
    }
  }, [isWarning]);
  
  // Event handlers for user activity
  useEffect(() => {
    const activityEvents = [
      "click",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "mousedown",
    ];
    
    const handleActivity = () => {
      recordActivity();
    };
    
    // Register activity listeners
    for (const event of activityEvents) {
      window.addEventListener(event, handleActivity);
    }
    
    return () => {
      for (const event of activityEvents) {
        window.removeEventListener(event, handleActivity);
      }
    };
  }, [recordActivity]);
  
  // Session check interval - only run when user is logged in
  useEffect(() => {
    if (!user) {
      setIsWarning(false);
      setTimeRemaining(SESSION_DURATION_SECONDS);
      setIsExpired(false);
      return;
    }
    
    const intervalId = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = (now - lastActivityRef.current) / 1000;
      
      if (timeSinceLastActivity >= SESSION_DURATION_SECONDS) {
        // Session expired
        setIsWarning(false);
        setTimeRemaining(0);
        setIsExpired(true);
        logout();
        router.push("/login?reason=session_expired");
        return;
      }
      
      if (timeSinceLastActivity >= SESSION_DURATION_SECONDS - WARNING_TIME_SECONDS) {
        // Warning period
        if (!isWarning) {
          setIsWarning(true);
        }
        
        const remaining = SESSION_DURATION_SECONDS - timeSinceLastActivity;
        setTimeRemaining(Math.ceil(remaining));
      } else {
        // Normal period
        if (isWarning) {
          setIsWarning(false);
        }
        
        setTimeRemaining(SESSION_DURATION_SECONDS - Math.floor(timeSinceLastActivity));
      }
    }, CHECK_INTERVAL_MS);
    
    return () => clearInterval(intervalId);
  }, [user, isWarning, logout, router]);
  
  // Clear warning timeout on unmount
  useEffect(() => {
    return () => {
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }
    };
  }, []);
  
  // Extend session
  const extendSession = useCallback(async (): Promise<void> => {
    try {
      const ttl = await refreshAccessToken();
      if (ttl > 0) {
        // Reset timer with new TTL
        lastActivityRef.current = Date.now();
        setTimeRemaining(SESSION_DURATION_SECONDS);
        setIsWarning(false);
      }
    } catch (error) {
      console.error("Failed to extend session:", error);
      throw error;
    }
  }, [refreshAccessToken]);
  
  // Force logout
  const forceLogout = useCallback(() => {
    logout();
    router.push("/login?reason=user_logout");
  }, [logout, router]);
  
  // Reset timer
  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIsWarning(false);
    setTimeRemaining(SESSION_DURATION_SECONDS);
  }, []);
  
  // Compute showWarning based on warning state and user presence
  const showWarning = isWarning && !!user;
  
  // Return state
  return {
    state: { isWarning, timeRemaining, isExpired },
    showWarning,
    timeRemaining,
    extendSession,
    forceLogout,
    resetTimer,
  };
}

// ---------------------------------------------------------------------------
// SessionProvider Component
// ---------------------------------------------------------------------------

export interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps): ReactNode {
  useSessionTimeout();
  
  return children;
}

// ---------------------------------------------------------------------------
// Hooks for accessing session timeout state
// ---------------------------------------------------------------------------

/**
 * Returns the current session timeout state
 */
export function useSessionState(): SessionTimeoutState {
  const { state } = useSessionTimeout();
  return state;
}

/**
 * Returns the time remaining until session expiry
 */
export function useSessionTimeRemaining(): number {
  const { timeRemaining } = useSessionTimeout();
  return timeRemaining;
}

/**
 * Returns whether the session warning is showing
 */
export function useSessionWarning(): boolean {
  const { showWarning } = useSessionTimeout();
  return showWarning;
}

/**
 * Returns function to extend the session
 */
export function useSessionExtender(): () => Promise<void> {
  const { extendSession } = useSessionTimeout();
  return extendSession;
}