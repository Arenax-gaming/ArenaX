"use client";

import { Component, ReactNode } from "react";
import { Button } from "./Button";
import { AlertTriangle, RefreshCw, Home, Mail, Copy, Check } from "lucide-react";
import { logError } from "@/lib/errorLogger";
import { determineErrorCategory, ErrorCategory } from "@/lib/errors";
import { datadogRum } from "@datadog/browser-rum";

// ─── Error message catalogue ──────────────────────────────────────────────────

const ERROR_MESSAGES: Record<
  ErrorCategory,
  { title: string; message: string; action: string }
> = {
  [ErrorCategory.NETWORK]: {
    title: "Connection Lost",
    message: "Please check your internet connection and try again.",
    action: "Retry",
  },
  [ErrorCategory.AUTHENTICATION]: {
    title: "Authentication Error",
    message: "Please log in again to continue.",
    action: "Go to Login",
  },
  [ErrorCategory.VALIDATION]: {
    title: "Invalid Input",
    message: "Please check your inputs and try again.",
    action: "Try Again",
  },
  [ErrorCategory.API]: {
    title: "Server Error",
    message: "Our servers are having issues. Please try again later.",
    action: "Retry",
  },
  [ErrorCategory.RUNTIME]: {
    title: "Something Went Wrong",
    message: "An unexpected error occurred. Please try again.",
    action: "Refresh",
  },
  [ErrorCategory.UNKNOWN]: {
    title: "Something Went Wrong",
    message: "An unexpected error occurred. Please try again.",
    action: "Refresh",
  },
};

// ─── Props / State ────────────────────────────────────────────────────────────

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  copied: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Top-level error boundary.  Wraps the entire locale layout so any uncaught
 * React render error is caught here.
 *
 * Integrates with `errorLogger` for structured logging + analytics tracking.
 * Uses `determineErrorCategory` from `errors.ts` rather than duplicating
 * keyword-matching logic inline.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    logError(error, {
      source: "ErrorBoundary",
      componentStack: errorInfo.componentStack,
    });

    // Forward to Datadog RUM for production monitoring.
    // Only include non-sensitive breadcrumbs — no tokens, passwords or PII.
    datadogRum.addError(error, {
      source: "ErrorBoundary",
      componentStack: errorInfo.componentStack ?? undefined,
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
    });

    this.props.onError?.(error, errorInfo);
  }

  // ── Actions ──────────────────────────────────────────────────────────────────

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  handleGoHome = (): void => {
    window.location.href = "/";
  };

  handleGoToLogin = (): void => {
    window.location.href = "/login";
  };

  handleReportIssue = (): void => {
    window.location.href = "/contact?error=true";
  };

  handleCopyErrorDetails = (): void => {
    const { error, errorInfo } = this.state;
    const details = [
      `Error: ${error?.message ?? "unknown"}`,
      `Stack: ${error?.stack ?? "–"}`,
      `Component stack: ${errorInfo?.componentStack ?? "–"}`,
    ].join("\n");

    navigator.clipboard.writeText(details).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2_000);
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const { error, errorInfo, copied } = this.state;
    const category = error ? determineErrorCategory(error) : ErrorCategory.UNKNOWN;
    const { title, message, action } = ERROR_MESSAGES[category];

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          {/* Icon */}
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
            <AlertTriangle className="w-8 h-8 text-destructive" aria-hidden="true" />
          </div>

          {/* Title */}
          <h1 className="text-xl font-bold text-foreground mb-2">{title}</h1>

          {/* Message */}
          <p className="text-sm text-muted-foreground mb-6">{message}</p>

          {/* Collapsible technical details */}
          {(error || errorInfo) && (
            <details className="mb-6 text-left">
              <summary className="text-xs text-muted-foreground cursor-pointer select-none">
                Technical Details
              </summary>
              <div className="mt-2 space-y-2">
                {error && (
                  <pre className="p-2 bg-muted rounded text-xs overflow-x-auto">
                    {error.message}
                  </pre>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs"
                    onClick={this.handleCopyErrorDetails}
                    aria-label="Copy error details to clipboard"
                  >
                    {copied ? (
                      <Check className="w-3 h-3 mr-1" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3 h-3 mr-1" aria-hidden="true" />
                    )}
                    {copied ? "Copied!" : "Copy Details"}
                  </Button>
                </div>
              </div>
            </details>
          )}

          {/* Action buttons */}
          <div className="space-y-3">
            {category === ErrorCategory.AUTHENTICATION ? (
              <Button onClick={this.handleGoToLogin} className="w-full" size="lg">
                {action}
              </Button>
            ) : (
              <Button onClick={this.handleRetry} className="w-full" size="lg">
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                {action}
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
