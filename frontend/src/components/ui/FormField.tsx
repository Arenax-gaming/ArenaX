"use client";

import * as React from "react";
import { CheckCircle, AlertCircle } from "lucide-react";
import { Input } from "./Input";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  error?: string;
  success?: boolean;
  disabled?: boolean;
  autoComplete?: string;
  className?: string;
  description?: string;
}

export const FormField = React.forwardRef<HTMLInputElement, FormFieldProps>(
  (
    {
      id,
      label,
      type = "text",
      value,
      onChange,
      placeholder,
      error,
      success,
      disabled,
      autoComplete,
      className,
      description,
    },
    ref
  ) => {
    const hasFeedback = error || success;

    return (
      <div className={cn("space-y-2", className)}>
        <label
          htmlFor={id}
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
        </label>
        <div className="relative">
          <Input
            ref={ref}
            id={id}
            type={type}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            disabled={disabled}
            error={!!error}
            autoComplete={autoComplete}
            aria-invalid={!!error}
            aria-describedby={
              error
                ? `${id}-error`
                : success
                ? `${id}-success`
                : description
                ? `${id}-description`
                : undefined
            }
            className={cn(
              success && "border-green-500 focus-visible:ring-green-500",
              "pr-10"
            )}
          />
          {hasFeedback && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {error ? (
                <AlertCircle
                  className="h-5 w-5 text-destructive"
                  aria-hidden="true"
                />
              ) : (
                success && (
                  <CheckCircle
                    className="h-5 w-5 text-green-500"
                    aria-hidden="true"
                  />
                )
              )}
            </div>
          )}
        </div>
        {description && !error && !success && (
          <p
            id={`${id}-description`}
            className="text-sm text-muted-foreground"
          >
            {description}
          </p>
        )}
        {error && (
          <p
            id={`${id}-error`}
            className="text-sm text-destructive flex items-center gap-2"
            role="alert"
          >
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {error}
          </p>
        )}
        {success && (
          <p
            id={`${id}-success`}
            className="text-sm text-green-600 flex items-center gap-2"
            role="status"
          >
            <CheckCircle className="h-4 w-4" aria-hidden="true" />
            Valid
          </p>
        )}
      </div>
    );
  }
);

FormField.displayName = "FormField";
