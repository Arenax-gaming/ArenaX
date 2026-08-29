"use client";

import { useEffect, useRef, useCallback } from "react";
import { Clock, RotateCcw, LogOut, Save } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import {
  useSessionExtender,
  useGracePeriodExpired,
} from "@/contexts/SessionTimeoutContext";
import {
  SESSION_DURATION_SECONDS,
  WARNING_TIME_SECONDS,
  GRACE_PERIOD_SECONDS,
} from "@/hooks/useSessionTimeout";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXTEND_DURATION_SECONDS = SESSION_DURATION_SECONDS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionTimeoutModalProps {
  isOpen: boolean;
  timeRemaining?: number | null;
  onExtend: () => Promise<void>;
  onForceLogout: () => void;
  onClose: () => void;
  className?: string;
  contentClassName?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionTimeoutModal({
  isOpen,
  timeRemaining = 0,
  onExtend,
  onForceLogout,
  onClose,
  className,
  contentClassName,
}: SessionTimeoutModalProps) {
  const remaining = timeRemaining ?? 0;
  const isClosingRef = useRef(false);
  const extendButtonRef = useRef<HTMLButtonElement>(null);
  const gracePeriodExpired = useGracePeriodExpired();
  
  // Auto-extend if user doesn't respond (within grace period)
  useEffect(() => {
    if (!isOpen || gracePeriodExpired) return;
    
    const timeToGracePeriod = timeRemaining - GRACE_PERIOD_SECONDS;
    if (timeToGracePeriod > 0 && timeToGracePeriod < WARNING_TIME_SECONDS) {
      const autoExtendTimeout = setTimeout(async () => {
        // Only auto-extend if user hasn't interacted and we're still in warning
        if (!isClosingRef.current && extendButtonRef.current) {
          try {
            await onExtend();
          } catch {
            // Ignore errors - user can still manually extend
          }
        }
      }, timeToGracePeriod * 1000);
      
      return () => clearTimeout(autoExtendTimeout);
    }
  }, [isOpen, timeRemaining, onExtend, gracePeriodExpired]);
  
  // Focus extend button when modal opens
  useEffect(() => {
    if (isOpen && extendButtonRef.current) {
      extendButtonRef.current.focus();
    }
  }, [isOpen]);
  
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);
  
  const handleExtend = useCallback(async (): Promise<void> => {
    isClosingRef.current = true;
    try {
      await onExtend();
      onClose();
    } catch (error) {
      console.error("Failed to extend session:", error);
      isClosingRef.current = false;
    }
  }, [onExtend, onClose]);
  
  const handleLogout = useCallback((): void => {
    isClosingRef.current = true;
    onForceLogout();
    onClose();
  }, [onForceLogout, onClose]);
  
  const handleClose = useCallback((): void => {
    // Prevent closing without taking action
    if (timeRemaining > GRACE_PERIOD_SECONDS) {
      extendButtonRef.current?.focus();
    } else {
      onClose();
    }
  }, [timeRemaining, onClose]);
  
  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Session Timeout Warning"
      size="md"
      position="center"
      closeOnOverlayClick={false}
      closeOnEscape={false}
      showCloseButton={false}
      className={className}
      contentClassName={contentClassName}
    >
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber/10">
          <Clock className="h-8 w-8 text-amber-500" aria-hidden="true" />
        </div>
        
        <h2
          id="session-timeout-title"
          className="text-xl font-semibold text-foreground"
        >
          Your session is about to expire
        </h2>
        
        <p
          id="session-timeout-description"
          className="mt-2 text-sm text-muted-foreground"
        >
          You will be logged out in{" "}
          <span className="font-semibold text-foreground">
            {formatTime(timeRemaining)}
          </span>
          . Extend your session to keep working.
        </p>
        
        <div className="mt-6 grid gap-3">
          <Button
            ref={extendButtonRef}
            onClick={handleExtend}
            className="w-full"
            size="lg"
          >
            <RotateCcw className="mr-2 h-5 w-5" aria-hidden="true" />
            Extend Session
          </Button>
          
          <Button
            onClick={handleLogout}
            variant="outline"
            className="w-full"
            size="lg"
          >
            <LogOut className="mr-2 h-5 w-5" aria-hidden="true" />
            Log Out Now
          </Button>
        </div>
        
        <p className="mt-4 text-xs text-muted-foreground">
          Your work will be saved. You can log back in anytime.
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// SessionTimeoutAlert Component (for non-modal use)
// ---------------------------------------------------------------------------

interface SessionTimeoutAlertProps {
  timeRemaining: number;
  onExtend: () => Promise<void>;
  className?: string;
}

export function SessionTimeoutAlert({
  timeRemaining,
  onExtend,
  className,
}: SessionTimeoutAlertProps) {
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);
  
  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 flex items-center gap-4 rounded-lg border bg-card px-6 py-4 shadow-lg",
        className
      )}
      role="alert"
      aria-live="assertive"
    >
      <Clock className="h-5 w-5 text-amber-500" aria-hidden="true" />
      
      <div className="flex-1">
        <p className="text-sm font-medium text-foreground">
          Session expires in {formatTime(timeRemaining)}
        </p>
      </div>
      
      <Button
        onClick={onExtend}
        size="sm"
        variant="outline"
        className="h-8"
      >
        <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
        Extend
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionGracePeriodAlert Component
// ---------------------------------------------------------------------------

interface SessionGracePeriodAlertProps {
  timeRemaining: number;
  onExtend: () => Promise<void>;
  onLogout: () => void;
  className?: string;
}

export function SessionGracePeriodAlert({
  timeRemaining,
  onExtend,
  onLogout,
  className,
}: SessionGracePeriodAlertProps) {
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);
  
  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex max-w-md flex-col gap-3 rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 px-6 py-4 shadow-lg",
        className
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            Session Almost Expired
          </h3>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
            You have {formatTime(timeRemaining)} remaining to extend your session or save your work.
          </p>
        </div>
      </div>
      
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={onExtend}
          size="sm"
          className="h-8 bg-amber-600 hover:bg-amber-700"
        >
          <Save className="mr-2 h-4 w-4" aria-hidden="true" />
          Extend Session
        </Button>
        <Button
          onClick={onLogout}
          size="sm"
          variant="outline"
          className="h-8 border-amber-600 text-amber-600 hover:bg-amber-100 dark:border-amber-500 dark:text-amber-500 dark:hover:bg-amber-900/30"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Log Out & Save
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SessionTimeoutIndicator Component
// ---------------------------------------------------------------------------

interface SessionTimeoutIndicatorProps {
  timeRemaining?: number | null;
  className?: string;
}

export function SessionTimeoutIndicator({
  timeRemaining = 0,
  className,
}: SessionTimeoutIndicatorProps) {
  const remaining = timeRemaining ?? 0;
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, []);
  
  const getColorClass = useCallback((seconds: number): string => {
    if (seconds <= GRACE_PERIOD_SECONDS) return "text-red-500";
    if (seconds <= WARNING_TIME_SECONDS) return "text-amber-500";
    return "text-muted-foreground";
  }, []);
  
  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      <Clock className={`h-4 w-4 ${getColorClass(remaining)}`} aria-hidden="true" />
      <span className={getColorClass(remaining)}>
        {formatTime(remaining)}
      </span>
    </div>
  );
}