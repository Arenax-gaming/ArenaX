import React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "secondary"
    | "outline"
    | "ghost"
    | "destructive"
    | "default"
    | "link";
  size?: "sm" | "md" | "lg" | "icon";
  loading?: boolean;
  /**
   * When `true`, the Button's classes/ref/handlers are merged onto its single
   * child element via `@radix-ui/react-slot`'s `Slot`. Use to compose a
   * Button-styled `<a>` / `<Link>` without producing invalid nested-button or
   * button-inside-anchor HTML.
   */
  asChild?: boolean;
}

const variantClasses = {
  primary:
    "bg-primary/90 text-white hover:bg-blue-700 focus-visible:ring-primary",
  secondary:
    "bg-gray-600 text-white hover:bg-surface-raised focus-visible:ring-gray-500",
  outline:
    "border border-border bg-transparent text-foreground/70 hover:bg-muted focus-visible:ring-gray-500",
  ghost:
    "text-foreground/70 hover:bg-muted focus-visible:ring-gray-500",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive",
  // Aliases used by existing call sites
  default:
    "bg-primary/90 text-white hover:bg-blue-700 focus-visible:ring-primary",
  link:
    "bg-transparent underline-offset-4 hover:underline text-primary p-0 h-auto",
};

const sizeClasses = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 py-2",
  lg: "h-12 px-6 text-lg",
  icon: "h-10 w-10",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      asChild = false,
      loading,
      children,
      disabled,
      type,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    const classes = cn(
      "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
      variantClasses[variant],
      sizeClasses[size],
      !asChild && loading && "cursor-not-allowed",
      className,
    );

    // When rendering a Slot, `type` / `disabled` are button-specific HTML
    // attributes that don't belong on arbitrary child elements. We omit them
    // here and let the consumer provide them on the child directly when needed.
    const buttonOnlyProps = asChild
      ? {}
      : { type: type ?? "button", disabled: disabled || loading };

    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        className={classes}
        {...buttonOnlyProps}
        {...props}
      >
        {!asChild && loading && (
          <svg
            className="mr-2 h-4 w-4 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
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
        )}
        {children}
      </Comp>
    );
  },
);

Button.displayName = "Button";
