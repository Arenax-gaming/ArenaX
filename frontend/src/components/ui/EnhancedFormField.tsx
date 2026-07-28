"use client";

/**
 * EnhancedFormField — Issue #830
 *
 * Form field component with real-time validation feedback, success indicators,
 * and accessibility enhancements.
 */

import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export interface EnhancedFormFieldProps {
  label: string;
  name: string;
  type?: "text" | "email" | "password" | "number" | "tel" | "url";
  placeholder?: string;
  value?: string;
  error?: string | null;
  isValidated?: boolean;
  isValidating?: boolean;
  touched?: boolean;
  required?: boolean;
  disabled?: boolean;
  description?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  className?: string;
  showSuccessIndicator?: boolean;
  autoComplete?: string;
}

export function EnhancedFormField({
  label,
  name,
  type = "text",
  placeholder,
  value,
  error,
  isValidated = false,
  isValidating = false,
  touched = false,
  required = false,
  disabled = false,
  description,
  onChange,
  onBlur,
  className,
  showSuccessIndicator = true,
  autoComplete,
}: EnhancedFormFieldProps) {
  const hasError = touched && !!error;
  const showSuccess = showSuccessIndicator && touched && isValidated && !error;
  const inputId = `field-${name}`;
  const errorId = `${inputId}-error`;
  const descriptionId = `${inputId}-description`;

  return (
    <div className={cn("space-y-2", className)}>
      <label
        htmlFor={inputId}
        className={cn(
          "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          hasError && "text-destructive"
        )}
      >
        {label}
        {required && <span className="text-destructive ml-1" aria-label="required">*</span>}
      </label>

      <div className="relative">
        <input
          id={inputId}
          name={name}
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={onChange}
          onBlur={onBlur}
          disabled={disabled || isValidating}
          required={required}
          autoComplete={autoComplete}
          aria-invalid={hasError}
          aria-describedby={cn(
            error && errorId,
            description && descriptionId
          ).trim() || undefined}
          className={cn(
            "flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background",
            "file:border-0 file:bg-transparent file:text-sm file:font-medium",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-colors duration-200",
            hasError && "border-destructive focus-visible:ring-destructive",
            showSuccess && "border-green-500 focus-visible:ring-green-500",
            !hasError && !showSuccess && "border-input",
            (showSuccess || isValidating) && "pr-10"
          )}
        />

        {/* Status indicators */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
          {isValidating && (
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground"
              aria-label="Validating"
            />
          )}
          {showSuccess && !isValidating && (
            <CheckCircle2
              className="h-4 w-4 text-green-500"
              aria-label="Valid"
            />
          )}
          {hasError && !isValidating && (
            <AlertCircle
              className="h-4 w-4 text-destructive"
              aria-label="Error"
            />
          )}
        </div>
      </div>

      {/* Description */}
      {description && !error && (
        <p
          id={descriptionId}
          className="text-sm text-muted-foreground"
        >
          {description}
        </p>
      )}

      {/* Error message */}
      {hasError && (
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="text-sm font-medium text-destructive flex items-start gap-1.5 animate-in slide-in-from-top-1"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {/* Success message (optional) */}
      {showSuccess && !hasError && (
        <p
          className="text-sm font-medium text-green-600 flex items-center gap-1.5 animate-in slide-in-from-top-1"
          aria-live="polite"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <span>Looks good!</span>
        </p>
      )}
    </div>
  );
}

export interface EnhancedTextAreaFieldProps extends Omit<EnhancedFormFieldProps, "type"> {
  rows?: number;
  maxLength?: number;
  showCharCount?: boolean;
}

export function EnhancedTextAreaField({
  label,
  name,
  placeholder,
  value,
  error,
  isValidated = false,
  isValidating = false,
  touched = false,
  required = false,
  disabled = false,
  description,
  onChange,
  onBlur,
  className,
  showSuccessIndicator = true,
  rows = 4,
  maxLength,
  showCharCount = false,
}: EnhancedTextAreaFieldProps) {
  const hasError = touched && !!error;
  const showSuccess = showSuccessIndicator && touched && isValidated && !error;
  const inputId = `field-${name}`;
  const errorId = `${inputId}-error`;
  const descriptionId = `${inputId}-description`;
  const charCount = value?.length || 0;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <label
          htmlFor={inputId}
          className={cn(
            "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
            hasError && "text-destructive"
          )}
        >
          {label}
          {required && <span className="text-destructive ml-1" aria-label="required">*</span>}
        </label>
        {showCharCount && maxLength && (
          <span className="text-xs text-muted-foreground">
            {charCount}/{maxLength}
          </span>
        )}
      </div>

      <div className="relative">
        <textarea
          id={inputId}
          name={name}
          value={value}
          placeholder={placeholder}
          onChange={onChange as any}
          onBlur={onBlur as any}
          disabled={disabled || isValidating}
          required={required}
          rows={rows}
          maxLength={maxLength}
          aria-invalid={hasError}
          aria-describedby={cn(
            error && errorId,
            description && descriptionId
          ).trim() || undefined}
          className={cn(
            "flex w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "transition-colors duration-200 resize-y",
            hasError && "border-destructive focus-visible:ring-destructive",
            showSuccess && "border-green-500 focus-visible:ring-green-500",
            !hasError && !showSuccess && "border-input"
          )}
        />

        {/* Status indicator for textarea */}
        {(isValidating || showSuccess || hasError) && (
          <div className="absolute right-3 top-3 flex items-center">
            {isValidating && (
              <Loader2
                className="h-4 w-4 animate-spin text-muted-foreground"
                aria-label="Validating"
              />
            )}
            {showSuccess && !isValidating && (
              <CheckCircle2
                className="h-4 w-4 text-green-500"
                aria-label="Valid"
              />
            )}
            {hasError && !isValidating && (
              <AlertCircle
                className="h-4 w-4 text-destructive"
                aria-label="Error"
              />
            )}
          </div>
        )}
      </div>

      {/* Description */}
      {description && !error && (
        <p
          id={descriptionId}
          className="text-sm text-muted-foreground"
        >
          {description}
        </p>
      )}

      {/* Error message */}
      {hasError && (
        <p
          id={errorId}
          role="alert"
          aria-live="polite"
          className="text-sm font-medium text-destructive flex items-start gap-1.5 animate-in slide-in-from-top-1"
        >
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {/* Success message (optional) */}
      {showSuccess && !hasError && (
        <p
          className="text-sm font-medium text-green-600 flex items-center gap-1.5 animate-in slide-in-from-top-1"
          aria-live="polite"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <span>Looks good!</span>
        </p>
      )}
    </div>
  );
}
