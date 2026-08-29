"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, RotateCcw, LogOut, Save, User, Shield, Activity } from "lucide-react";
import { SessionTimeoutModal, SessionTimeoutIndicator } from "@/components/ui/SessionTimeoutModal";
import {
  useSessionTimeoutContext,
  useSessionState,
  useSessionTimeRemaining,
  useSessionWarning,
  useSessionExtender,
  useGracePeriodExpired,
} from "@/contexts/SessionTimeoutContext";

// Import constants for reference
import { 
  SESSION_DURATION_SECONDS, 
  WARNING_TIME_SECONDS, 
  GRACE_PERIOD_SECONDS 
} from "@/hooks/useSessionTimeout";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXTEND_DURATION_SECONDS = SESSION_DURATION_SECONDS;

// ---------------------------------------------------------------------------
// Demo Components
// ---------------------------------------------------------------------------

function SessionInfoCard() {
  const state = useSessionState();
  const timeRemaining = useSessionTimeRemaining();
  const isWarning = useSessionWarning();
  const gracePeriodExpired = useGracePeriodExpired();
  
  const statusColor = gracePeriodExpired 
    ? "text-red-500" 
    : isWarning 
      ? "text-amber-500" 
      : "text-emerald-500";
  
  const statusText = gracePeriodExpired
    ? "Grace Period Expired"
    : isWarning
      ? "Session Warning Active"
      : "Session Active";
  
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Activity className="h-5 w-5" />
        Session Status
      </h3>
      
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Status</p>
          <p className={`font-semibold ${statusColor}`}>{statusText}</p>
        </div>
        
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Time Remaining</p>
          <p className="font-mono text-lg font-semibold">
            {Math.floor(timeRemaining / 60)}:{String(timeRemaining % 60).padStart(2, "0")}
          </p>
        </div>
        
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Warning Active</p>
          <p className="font-medium">{isWarning ? "Yes" : "No"}</p>
        </div>
        
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Grace Period</p>
          <p className="font-medium">{gracePeriodExpired ? "Expired" : "Active"}</p>
        </div>
      </div>
    </div>
  );
}

function SessionControls() {
  const { extendSession, forceLogout, resetTimer } = useSessionTimeoutContext();
  const [isExtending, setIsExtending] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  
  const handleExtend = async () => {
    setIsExtending(true);
    try {
      await extendSession();
    } catch (error) {
      console.error("Failed to extend:", error);
    } finally {
      setIsExtending(false);
    }
  };
  
  const handleLogout = () => {
    setIsLoggingOut(true);
    setTimeout(() => {
      forceLogout();
      setIsLoggingOut(false);
    }, 1000); // Simulate logout processing
  };
  
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <Shield className="h-5 w-5" />
        Session Controls
      </h3>
      
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleExtend}
          disabled={isExtending}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" />
          {isExtending ? "Extending..." : "Extend Session"}
        </button>
        
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <LogOut className="h-4 w-4" />
          {isLoggingOut ? "Logging Out..." : "Force Logout"}
        </button>
        
        <button
          onClick={resetTimer}
          className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <Activity className="h-4 w-4" />
          Reset Timer
        </button>
      </div>
    </div>
  );
}

function ConstantsReference() {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
        <User className="h-5 w-5" />
        Constants Reference
      </h3>
      
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1 rounded-lg bg-muted/50 p-4">
          <p className="text-sm font-medium">Session Duration</p>
          <p className="text-2xl font-bold">{SESSION_DURATION_SECONDS / 60} min</p>
          <p className="text-xs text-muted-foreground">
            Total session time before warning
          </p>
        </div>
        
        <div className="space-y-1 rounded-lg bg-muted/50 p-4">
          <p className="text-sm font-medium">Warning Time</p>
          <p className="text-2xl font-bold">{WARNING_TIME_SECONDS / 60} min</p>
          <p className="text-xs text-muted-foreground">
            Time before expiry to show warning
          </p>
        </div>
        
        <div className="space-y-1 rounded-lg bg-muted/50 p-4">
          <p className="text-sm font-medium">Grace Period</p>
          <p className="text-2xl font-bold">{GRACE_PERIOD_SECONDS / 60} min</p>
          <p className="text-xs text-muted-foreground">
            Time to act before auto-extend
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function SessionTimeoutDemoPage() {
  const { showWarning, extendSession, forceLogout } = useSessionTimeoutContext();
  const timeRemaining = useSessionTimeRemaining();
  const router = useRouter();
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Session Timeout Demo</h1>
          <p className="text-muted-foreground">
            Demonstration of session timeout features
          </p>
        </div>
        
        <button
          onClick={() => router.push("/")}
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Back to Home
        </button>
      </div>
      
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <SessionInfoCard />
          <SessionControls />
          <ConstantsReference />
          
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold">Usage Examples</h3>
            
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 p-4">
                <h4 className="mb-2 font-medium">Hook Usage</h4>
                <pre className="text-xs text-muted-foreground overflow-x-auto">
                  {`const {
  state,
  showWarning,
  timeRemaining,
  extendSession,
  forceLogout,
  resetTimer,
} = useSessionTimeoutContext();`}
                </pre>
              </div>
              
              <div className="rounded-md bg-muted/50 p-4">
                <h4 className="mb-2 font-medium">Individual Hooks</h4>
                <pre className="text-xs text-muted-foreground overflow-x-auto">
                  {`const state = useSessionState();
const timeRemaining = useSessionTimeRemaining();
const isWarning = useSessionWarning();
const gracePeriodExpired = useGracePeriodExpired();`}
                </pre>
              </div>
              
              <div className="rounded-md bg-muted/50 p-4">
                <h4 className="mb-2 font-medium">Modal Component</h4>
                <pre className="text-xs text-muted-foreground overflow-x-auto">
                  {`<SessionTimeoutModal
  isOpen={showWarning}
  timeRemaining={timeRemaining}
  onExtend={extendSession}
  onForceLogout={forceLogout}
  onClose={() => {}}
/>`}
                </pre>
              </div>
            </div>
          </div>
        </div>
        
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold">Session Timer</h3>
            
            <div className="flex items-center justify-center py-8">
              <SessionTimeoutIndicator 
                timeRemaining={timeRemaining} 
                className="text-3xl font-mono"
              />
            </div>
            
            <p className="text-center text-sm text-muted-foreground">
              This component can be placed anywhere in your app
            </p>
          </div>
          
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold">Active Session</h3>
            
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm">User activity tracked</span>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm">Session auto-extend available</span>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-sm">Work will be saved</span>
              </div>
            </div>
          </div>
          
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold">Quick Stats</h3>
            
            <div className="grid gap-3 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Warning starts in</span>
                <span className="font-medium">{WARNING_TIME_SECONDS / 60} min</span>
              </div>
              
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Total session time</span>
                <span className="font-medium">{SESSION_DURATION_SECONDS / 60} min</span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-muted-foreground">Grace period</span>
                <span className="font-medium">{GRACE_PERIOD_SECONDS / 60} min</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Session timeout warning modal */}
      <SessionTimeoutModal
        isOpen={showWarning}
        timeRemaining={timeRemaining}
        onExtend={extendSession}
        onForceLogout={forceLogout}
        onClose={() => {}}
      />
    </div>
  );
}