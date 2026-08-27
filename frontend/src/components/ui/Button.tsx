import React from "react";
import { cn } from "../../lib/utils";
import { Slot } from "@radix-ui/react-slot";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "default"
    | "secondary"
    | "outline"
    | "ghost"
    | "link"
    | "destructive";
  size?: "sm" | "md" | "lg" | "icon";
  /** Shows a loading spinner and sets aria-busy + disabled. */
  loading?: boolean;
  /** Screen-reader label for the loading state. Defaults to "Loading…". */
  loadingLabel?: string;
  /** Render the button styles on a child element (Radix Slot pattern). */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading,
      loadingLabel = "Loading\u2026",
      children,
      disabled,
      asChild = false,
      "aria-label": ariaLabel,
      ...props
    },
    ref,
  ) => {
    const baseClasses =
      "inline-flex items-center justify-center rounded-md font-medium transition-colors " +
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
      "disabled:pointer-events-none disabled:opacity-50";

    const variantClasses = {
      primary:
        "bg-primary/90 text-white hover:bg-blue-700 focus-visible:ring-primary",
      default:
        "bg-primary/90 text-white hover:bg-blue-700 focus-visible:ring-primary",
      secondary:
        "bg-gray-600 text-white hover:bg-surface-raised focus-visible:ring-gray-500",
      outline:
        "border border-border bg-transparent text-foreground/70 hover:bg-muted focus-visible:ring-gray-500",
      ghost: "text-foreground/70 hover:bg-muted focus-visible:ring-gray-500",
      link: "text-primary underline-offset-4 hover:underline",
      destructive:
        "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
    };

    const sizeClasses = {
      sm: "h-8 px-3 text-sm",
      md: "h-10 px-4 py-2",
      lg: "h-12 px-6 text-lg",
      icon: "h-10 w-10",
    };

    const buttonContent = (
      <>
        {loading && (
          <>
            {/* Spinner — hidden from AT; sr-only label provides context */}
            <svg
              className="mr-2 h-4 w-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
              focusable="false"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {/* Announced to screen readers; visually replaced by spinner */}
            <span className="sr-only">{loadingLabel}</span>
          </>
        )}
        {children}
      </>
    );

    const buttonClasses = cn(
      baseClasses,
      variantClasses[variant],
      sizeClasses[size],
      loading && "cursor-not-allowed",
      className,
    );

    if (asChild) {
      return (
        <Slot
          className={buttonClasses}
          aria-busy={loading || undefined}
          aria-disabled={disabled || loading}
          aria-label={ariaLabel}
          {...props}
        >
          {buttonContent}
        </Slot>
      );
    }

    return (
      <button
        className={buttonClasses}
        ref={ref}
        disabled={disabled || loading}
        aria-disabled={disabled || loading}
        aria-busy={loading || undefined}
        aria-label={ariaLabel}
        {...props}
      >
        {buttonContent}
      </button>
    );
  },
);

Button.displayName = "Button";
