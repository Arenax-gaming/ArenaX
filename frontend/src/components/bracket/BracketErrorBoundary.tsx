"use client";

import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { logError } from "@/lib/errorLogger";
import { determineErrorCategory, ErrorCategory } from "@/lib/errors";
import { cn } from "@/lib/utils";

// ─── Props / State ────────────────────────────────────────────────────────────

interface BracketErrorBoundaryProps {
  children: ReactNode;
  /** Tournament name shown in fallback UI */
  tournamentName?: string;
  /** Tournament ID shown in fallback UI */
  tournamentId?: string;
  /** Additional tournament info to show when bracket fails */
  tournamentInfo?: {
    status?: string;
    participantCount?: number;
    startDate?: string;
  };
  /** Custom fallback to render instead of the default UI */
  fallback?: ReactNode;
  /** Optional extra class names for the wrapper div */
  className?: string;
  /** Called when an error is caught — useful for parent-level reporting */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface BracketErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
  retryCount: number;
}

const MAX_BRACKET_RETRIES = 2;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * BracketErrorBoundary
 *
 * Wraps SingleEliminationBracket to catch rendering errors without crashing
 * the entire tournament page. Provides a recovery-focused fallback with:
 *
 * - Tournament context preserved in the error UI
 * - Retry button with exhaustion message after 2 attempts
 * - Unique error ID for support/debugging
 * - Accessibility features (role="alert", aria-live)
 * - Structured error logging to errorLogger + Datadog RUM
 *
 * @accessibility
 *   - Fallback has role="alert" to announce errors to screen readers
 *   - Retry button is keyboard-focusable with descriptive aria-label
 *   - Tournament info remains accessible when bracket fails
 *   - Meets WCAG 2.1 AA contrast and touch target minimums
 */
export class BracketErrorBoundary extends Component<
  BracketErrorBoundaryProps,
  BracketErrorBoundaryState
> {
  constructor(props: BracketErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorId: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<BracketErrorBoundaryState> {
    const errorId = `bracket-err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return { hasError: true, error, errorId };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log to ArenaX error logger (which integrates with Datadog RUM)
    logError(error, {
      source: "BracketErrorBoundary",
      tournamentId: this.props.tournamentId,
      tournamentName: this.props.tournamentName,
      errorId: this.state.errorId,
      componentStack: info.componentStack,
      retryCount: this.state.retryCount,
    });

    // Call parent's onError callback if provided
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
    const { hasError, error, errorId, retryCount } = this.state;
    const { children, fallback, tournamentName, tournamentId, tournamentInfo, className } =
      this.props;

    if (!hasError) return children;

    // Allow custom fallback
    if (fallback) return fallback;

    const category = error ? determineErrorCategory(error) : ErrorCategory.UNKNOWN;
    const isAuth = category === ErrorCategory.AUTHENTICATION;
    const exhausted = retryCount >= MAX_BRACKET_RETRIES;

    return (
      <div
        role="alert"
        aria-live="assertive"
        aria-label="Bracket rendering error"
        className={cn(
          "flex flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/40 bg-destructive/8 p-6 text-center",
          className,
        )}
      >
        {/* Error icon and heading */}
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/15">
          <AlertTriangle
            className="h-6 w-6 text-destructive"
            aria-hidden="true"
          />
        </div>

        <div>
          <h3 className="text-base font-semibold text-foreground">
            Bracket failed to load
          </h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            The tournament bracket could not be displayed. Tournament information is still available below.
          </p>

          {/* Show error ID for support reference */}
          {errorId && (
            <p className="mt-2 text-xs text-muted-foreground">
              Error ID:{" "}
              <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono">
                {errorId}
              </code>
            </p>
          )}

          {/* Show tech error message in dev mode only */}
          {error && process.env.NODE_ENV === "development" && (
            <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
              {error.message}
            </p>
          )}
        </div>

        {/* Action button */}
        {isAuth ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.location.href = "/login";
            }}
            aria-label="Sign in again to access the bracket"
          >
            Sign in again
          </Button>
        ) : exhausted ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              The bracket is still having trouble loading.
            </p>
            <a href="/contact?error=bracket" className="inline-block">
              <Button size="sm" variant="outline">
                Contact support
              </Button>
            </a>
          </div>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={this.handleRetry}
            aria-label={`Retry loading the tournament bracket (attempt ${retryCount + 1})`}
            className="gap-2"
          >
            <RefreshCw
              className="h-3.5 w-3.5"
              aria-hidden="true"
            />
            Retry{retryCount > 0 ? ` (${retryCount}/${MAX_BRACKET_RETRIES})` : ""}
          </Button>
        )}

        {/* Tournament info fallback — visible even when bracket fails */}
        {(tournamentName || tournamentInfo) && (
          <div
            className="mt-4 w-full rounded-lg bg-muted/40 p-4 text-left"
            aria-label="Tournament information"
          >
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tournament Information
            </h4>
            <div className="space-y-2">
              {tournamentName && (
                <div className="text-sm">
                  <span className="font-medium text-foreground">{tournamentName}</span>
                </div>
              )}
              {tournamentId && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">ID:</span> {tournamentId}
                </p>
              )}
              {tournamentInfo?.status && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Status:</span>{" "}
                  {tournamentInfo.status}
                </p>
              )}
              {tournamentInfo?.participantCount !== undefined && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Participants:</span>{" "}
                  {tournamentInfo.participantCount}
                </p>
              )}
              {tournamentInfo?.startDate && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Start Date:</span>{" "}
                  {tournamentInfo.startDate}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
}

export default BracketErrorBoundary;
