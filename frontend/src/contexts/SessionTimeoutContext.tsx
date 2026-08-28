"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { SESSION_DURATION_SECONDS, WARNING_TIME_SECONDS, GRACE_PERIOD_SECONDS } from "@/hooks/useSessionTimeout";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionTimeoutContextType {
  /** Current session timeout state */
  state: {
    isWarning: boolean;
    timeRemaining: number;
    isExpired: boolean;
  };
  
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
  
  /** Grace period expired */
  gracePeriodExpired: boolean;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SessionTimeoutContext = createContext<SessionTimeoutContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useSessionTimeoutContext = () => {
  const ctx = useContext(SessionTimeoutContext);
  if (ctx === undefined) {
    throw new Error("useSessionTimeoutContext must be used within a SessionTimeoutProvider");
  }
  return ctx;
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const SessionTimeoutProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { refreshAccessToken, logout } = useAuth();
  
  const [isWarning, setIsWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(SESSION_DURATION_SECONDS);
  const [isExpired, setIsExpired] = useState(false);
  const [gracePeriodExpired, setGracePeriodExpired] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  
  // Track activity
  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    
    // Clear warning if user is active
    if (isWarning) {
      setIsWarning(false);
      setGracePeriodExpired(false);
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
  
  // Session check interval
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = (now - lastActivityRef.current) / 1000;
      
      if (timeSinceLastActivity >= SESSION_DURATION_SECONDS) {
        // Session expired
        setIsWarning(false);
        setTimeRemaining(0);
        setIsExpired(true);
        setGracePeriodExpired(true);
        logout();
      } else if (timeSinceLastActivity >= SESSION_DURATION_SECONDS - WARNING_TIME_SECONDS) {
        // Warning period
        if (!isWarning) {
          setIsWarning(true);
        }
        
        const remaining = SESSION_DURATION_SECONDS - timeSinceLastActivity;
        setTimeRemaining(Math.ceil(remaining));
        
        // Check if grace period has expired
        if (remaining <= GRACE_PERIOD_SECONDS && !gracePeriodExpired) {
          setGracePeriodExpired(true);
        }
      } else {
        // Normal period
        if (isWarning) {
          setIsWarning(false);
          setGracePeriodExpired(false);
        }
        
        setTimeRemaining(SESSION_DURATION_SECONDS - Math.floor(timeSinceLastActivity));
      }
    }, 1000);
    
    return () => clearInterval(checkInterval);
  }, [isWarning, gracePeriodExpired, logout]);
  
  // Extend session
  const extendSession = useCallback(async (): Promise<void> => {
    try {
      const ttl = await refreshAccessToken();
      if (ttl > 0) {
        // Reset timer with new TTL
        lastActivityRef.current = Date.now();
        setTimeRemaining(SESSION_DURATION_SECONDS);
        setIsWarning(false);
        setGracePeriodExpired(false);
      }
    } catch (error) {
      console.error("Failed to extend session:", error);
      throw error;
    }
  }, [refreshAccessToken]);
  
  // Force logout
  const forceLogout = useCallback(() => {
    logout();
  }, [logout]);
  
  // Reset timer
  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setIsWarning(false);
    setTimeRemaining(SESSION_DURATION_SECONDS);
    setGracePeriodExpired(false);
  }, []);
  
  // Compute showWarning based on warning state
  const showWarning = isWarning;
  
  // Return state
  return (
    <SessionTimeoutContext.Provider
      value={{
        state: { isWarning, timeRemaining, isExpired },
        showWarning,
        timeRemaining,
        extendSession,
        forceLogout,
        resetTimer,
        gracePeriodExpired,
      }}
    >
      {children}
    </SessionTimeoutContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Hooks for accessing session timeout state
// ---------------------------------------------------------------------------

/**
 * Returns the current session timeout state
 */
export function useSessionState(): {
  isWarning: boolean;
  timeRemaining: number;
  isExpired: boolean;
} {
  const { state } = useSessionTimeoutContext();
  return state;
}

/**
 * Returns the time remaining until session expiry
 */
export function useSessionTimeRemaining(): number {
  const { timeRemaining } = useSessionTimeoutContext();
  return timeRemaining;
}

/**
 * Returns whether the session warning is showing
 */
export function useSessionWarning(): boolean {
  const { showWarning } = useSessionTimeoutContext();
  return showWarning;
}

/**
 * Returns function to extend the session
 */
export function useSessionExtender(): () => Promise<void> {
  const { extendSession } = useSessionTimeoutContext();
  return extendSession;
}

/**
 * Returns whether the grace period has expired
 */
export function useGracePeriodExpired(): boolean {
  const { gracePeriodExpired } = useSessionTimeoutContext();
  return gracePeriodExpired;
}