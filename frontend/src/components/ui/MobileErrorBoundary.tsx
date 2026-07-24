"use client";

import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { AlertTriangle, RefreshCw, Home, Mail } from "lucide-react";
import { logError } from "@/lib/errorLogger";
import { determineErrorCategory, ErrorCategory } from "@/lib/errors";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MobileErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface MobileErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ─── Error message map ────────────────────────────────────────────────────────

const MOBILE_ERROR_MESSAGES: Record<
  "network" | "timeout" | "offline" | "auth" | "generic",
  { title: string; message: string; action: string }
> = {
  network: {
    title: "Connection Lost",
    message: "Please check your internet connection and try again.",
    action: "Retry",
  },
  timeout: {
    title: "Request Timeout",
    message: "The server took too long to respond. Please try again.",
    action: "Try Again",
  },
  offline: {
    title: "You\u2019re Offline",
    message: "Please connect to the internet to continue.",
    action: "Go Back",
  },
  auth: {
    title: "Session Expired",
    message: "Please sign in again to continue.",
    action: "Sign In",
  },
  generic: {
    title: "Something Went Wrong",
    message: "An unexpected error occurred. Please try again.",
    action: "Refresh",
  },
};

type MobileErrorType = keyof typeof MOBILE_ERROR_MESSAGES;

// ─── Component ────────────────────────────────────────────────────────────────

export class MobileErrorBoundary extends Component<
  MobileErrorBoundaryProps,
  MobileErrorBoundaryState
> {
  constructor(props: MobileErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): MobileErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logError(error, {
      source: "MobileErrorBoundary",
      componentStack: errorInfo.componentStack,
    });
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = (): void => {
    window.location.href = "/";
  };

  handleReportIssue = (): void => {
    window.location.href = "/contact?error=true";
  };

  getErrorType(): MobileErrorType {
    const { error } = this.state;
    if (!error) return "generic";

    const category = determineErrorCategory(error);

    switch (category) {
      case ErrorCategory.NETWORK:
        return error.message.toLowerCase().includes("timeout") ? "timeout" : "network";
      case ErrorCategory.AUTHENTICATION:
        return "auth";
      default: {
        const msg = error.message.toLowerCase();
        if (msg.includes("offline")) return "offline";
        return "generic";
      }
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const errorType = this.getErrorType();
    const info = MOBILE_ERROR_MESSAGES[errorType];

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          {/* Icon */}
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
            <AlertTriangle className="w-8 h-8 text-destructive" aria-hidden="true" />
          </div>

          {/* Title */}
          <h1 className="text-xl font-bold text-foreground mb-2">{info.title}</h1>

          {/* Message */}
          <p className="text-sm text-muted-foreground mb-6">{info.message}</p>

          {/* Technical details (collapsed) */}
          {this.state.error && (
            <details className="mb-6 text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                Technical details
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto">
                {this.state.error.message}
              </pre>
            </details>
          )}

          {/* Actions */}
          <div className="space-y-3">
            {errorType === "auth" ? (
              <Button
                onClick={() => { window.location.href = "/login"; }}
                className="w-full"
                size="lg"
              >
                {info.action}
              </Button>
            ) : (
              <Button onClick={this.handleRetry} className="w-full" size="lg">
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                {info.action}
              </Button>
            )}

            <div className="flex gap-3">
              <Button onClick={this.handleGoHome} variant="outline" className="flex-1">
                <Home className="w-4 h-4 mr-2" aria-hidden="true" />
                Home
              </Button>
              <Button onClick={this.handleReportIssue} variant="ghost" className="flex-1">
                <Mail className="w-4 h-4 mr-2" aria-hidden="true" />
                Report
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Thin hook for imperatively handling errors inside mobile-specific components.
 * Logs the error via `errorLogger` and fires gtag if available.
 */
export function useMobileErrorHandler() {
  const handleError = (error: Error, metadata?: Record<string, unknown>): void => {
    logError(error, { source: "useMobileErrorHandler", ...metadata });
  };

  return { handleError };
}
