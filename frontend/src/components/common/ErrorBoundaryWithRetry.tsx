"use client";

import React, { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { logError } from "@/lib/errorLogger";
import { determineErrorCategory, ErrorCategory } from "@/lib/errors";
import { cn } from "@/lib/utils";

// ─── Props / State ────────────────────────────────────────────────────────────

export interface ErrorBoundaryWithRetryProps {
  children: ReactNode;
  /** Maximum number of automatic retry attempts before giving up (default: 3). */
  maxRetries?: number;
  /** Custom fallback rendered after all retries are exhausted. */
  fallback?: ReactNode;
  /** Extra classes for the error card wrapper. */
  className?: string;
  /** Called on every caught error. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

export interface ErrorBoundaryWithRetryState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Error boundary with configurable max-retry logic.  Uses the design system
 * (Button, Tailwind tokens) and integrates with `errorLogger`.
 *
 * @example
 * ```tsx
 * <ErrorBoundaryWithRetry maxRetries={2} label="Match Feed">
 *   <MatchFeed />
 * </ErrorBoundaryWithRetry>
 * ```
 */
export class ErrorBoundaryWithRetry extends Component<
  ErrorBoundaryWithRetryProps,
  ErrorBoundaryWithRetryState
> {
  constructor(props: ErrorBoundaryWithRetryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryWithRetryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logError(error, {
      source: "ErrorBoundaryWithRetry",
      componentStack: info.componentStack,
      retryCount: this.state.retryCount,
    });
    this.props.onError?.(error, info);
  }

  handleRetry = (): void => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  render() {
    const { hasError, error, retryCount } = this.state;
    const { children, maxRetries = 3, fallback, className } = this.props;

    if (!hasError) return children;

    // All retries exhausted — show custom fallback or a final message
    if (retryCount >= maxRetries) {
      if (fallback) return fallback;
      return (
        <div
          role="alert"
          className={cn(
            "rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center",
            className,
          )}
        >
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">
            Something went wrong and couldn&apos;t be recovered.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Maximum retries ({maxRetries}) exceeded.{" "}
            <a href="/contact?error=true" className="underline underline-offset-2">
              Contact support
            </a>
          </p>
        </div>
      );
    }

    const category = error ? determineErrorCategory(error) : ErrorCategory.UNKNOWN;
    const isAuth = category === ErrorCategory.AUTHENTICATION;

    return (
      <div
        role="alert"
        aria-live="polite"
        className={cn(
          "rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center",
          className,
        )}
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
        </div>

        <p className="mb-1 text-sm font-medium text-foreground">
          Something went wrong
        </p>

        {error && (
          <p className="mb-4 text-xs text-muted-foreground line-clamp-2">
            {error.message}
          </p>
        )}

        {isAuth ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { window.location.href = "/login"; }}
          >
            Sign in again
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={this.handleRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Retry ({retryCount}/{maxRetries})
          </Button>
        )}
      </div>
    );
  }
}
