"use client";

import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { logError } from "@/lib/errorLogger";
import { determineErrorCategory, ErrorCategory } from "@/lib/errors";
import { cn } from "@/lib/utils";

// ─── Props / State ────────────────────────────────────────────────────────────

interface SectionErrorBoundaryProps {
  children: ReactNode;
  /** Section label shown in the fallback UI (e.g. "Tournament Bracket"). */
  label?: string;
  /** Custom fallback to render instead of the default UI. */
  fallback?: ReactNode;
  /** Optional extra class names for the wrapper div. */
  className?: string;
  /** Called when an error is caught — useful for parent-level reporting. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

const MAX_SECTION_RETRIES = 3;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Lightweight error boundary intended for individual page sections (cards,
 * panels, widgets).  Unlike `ErrorBoundary` it does **not** take over the full
 * screen — it renders a compact inline fallback so the rest of the page stays
 * usable.
 *
 * Features:
 * - Up to 3 inline retry attempts before showing a "contact support" message
 * - Integrates with `errorLogger` for structured tracking
 * - Auth errors skip retry and show a "sign in again" nudge
 */
export class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<SectionErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logError(error, {
      source: "SectionErrorBoundary",
      section: this.props.label,
      componentStack: info.componentStack,
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
    const { children, fallback, label, className } = this.props;

    if (!hasError) return children;

    // Allow custom fallback
    if (fallback) return fallback;

    const category = error ? determineErrorCategory(error) : ErrorCategory.UNKNOWN;
    const isAuth = category === ErrorCategory.AUTHENTICATION;
    const exhausted = retryCount >= MAX_SECTION_RETRIES;

    return (
      <div
        role="alert"
        aria-live="polite"
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center",
          className,
        )}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
        </div>

        <div>
          <p className="text-sm font-medium text-foreground">
            {label ? `${label} failed to load` : "This section failed to load"}
          </p>
          {error && (
            <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
              {error.message}
            </p>
          )}
        </div>

        {isAuth ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => { window.location.href = "/login"; }}
          >
            Sign in again
          </Button>
        ) : exhausted ? (
          <p className="text-xs text-muted-foreground">
            Still having trouble?{" "}
            <a href="/contact?error=true" className="underline underline-offset-2">
              Contact support
            </a>
          </p>
        ) : (
          <Button size="sm" variant="outline" onClick={this.handleRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Retry{retryCount > 0 ? ` (${retryCount}/${MAX_SECTION_RETRIES})` : ""}
          </Button>
        )}
      </div>
    );
  }
}
