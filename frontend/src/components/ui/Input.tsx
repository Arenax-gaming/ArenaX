import * as React from "react"
import { CheckCircle2, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  success?: boolean;
  validationState?: 'idle' | 'validating' | 'valid' | 'invalid';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, error, success, validationState = 'idle', ...props }, ref) => {
    const showSuccess = success || validationState === 'valid';
    const showError = error || validationState === 'invalid';

    return (
      <div className="relative">
        <input
          type={type}
          className={cn(
            "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            "pr-10", // Add padding for icons
            showError && "border-destructive focus-visible:ring-destructive",
            showSuccess && "border-green-500 focus-visible:ring-green-500",
            className
          )}
          ref={ref}
          aria-invalid={showError}
          aria-describedby={showError ? `${props.id}-error` : showSuccess ? `${props.id}-success` : undefined}
          {...props}
        />
        {/* Validation Icon */}
        {showSuccess && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          </div>
        )}
        {showError && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true">
            <XCircle className="h-5 w-5 text-destructive" />
          </div>
        )}
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input }
