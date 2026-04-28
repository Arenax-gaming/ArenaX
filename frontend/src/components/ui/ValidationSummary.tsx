"use client";

import { AlertTriangle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ValidationSummaryProps {
  errors: string[];
  className?: string;
}

export const ValidationSummary = ({ errors, className }: ValidationSummaryProps) => {
  if (errors.length === 0) return null;

  return (
    <div
      className={cn(
        "bg-destructive/10 border border-destructive/20 rounded-lg p-4 space-y-2",
        className
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center gap-2 text-destructive font-medium">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        <span>
          Please fix the following error{errors.length > 1 ? "s" : ""}:
        </span>
      </div>
      <ul className="space-y-1 ml-7">
        {errors.map((error, index) => (
          <li key={index} className="text-sm text-destructive">
            • {error}
          </li>
        ))}
      </ul>
    </div>
  );
};

interface ValidationSuccessProps {
  message?: string;
  className?: string;
}

export const ValidationSuccess = ({
  message = "All fields are valid",
  className,
}: ValidationSuccessProps) => {
  return (
    <div
      className={cn(
        "bg-green-500/10 border border-green-500/20 rounded-lg p-3",
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-green-600">
        <CheckCircle className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
};
