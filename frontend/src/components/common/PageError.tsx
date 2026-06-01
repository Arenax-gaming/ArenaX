/**
 * PageError — reusable full-page / in-page error state.
 *
 * Used both by Next.js error.tsx boundary files and inline inside
 * client components that catch API errors themselves.
 */
import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface PageErrorProps {
  /** Short headline shown in bold. Defaults to "Something went wrong". */
  title?: string;
  /** Optional detail message — e.g. the error.message from the boundary. */
  message?: string;
  /** Called when the user clicks "Try again". */
  onRetry?: () => void;
  /** Label for the retry button. Defaults to "Try again". */
  retryLabel?: string;
  /** Extra Tailwind classes on the outer wrapper. */
  className?: string;
  /** Whether the retry button is in a loading state. */
  retrying?: boolean;
}

export function PageError({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  className,
  retrying = false,
}: PageErrorProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-16 px-4 text-center",
        className
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle
          className="h-8 w-8 text-destructive"
          aria-hidden="true"
        />
      </div>

      <h2 className="mb-2 text-xl font-semibold text-foreground">{title}</h2>

      {message && (
        <p className="mb-6 max-w-md text-sm text-muted-foreground">{message}</p>
      )}

      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          loading={retrying}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
