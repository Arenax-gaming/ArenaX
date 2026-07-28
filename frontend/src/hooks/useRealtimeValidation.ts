"use client";

/**
 * useRealtimeValidation — Issue #830
 *
 * Enhanced form validation hook with real-time feedback, field-level validation,
 * debouncing, and clear error messages.
 *
 * Features:
 *  - Real-time validation with configurable debouncing
 *  - Field-level validation on blur/change/submit
 *  - Success indicators for validated fields
 *  - Async validation support
 *  - Clear, user-friendly error messages
 *  - Validation state tracking
 *
 * @example
 * const { register, errors, validatedFields, isValidating, validate } = 
 *   useRealtimeValidation(loginSchema, "login", {
 *     mode: "onChange",
 *     debounceMs: 300,
 *   });
 */

import { useState, useCallback, useRef, useEffect } from "react";
import type { ZodSchema } from "zod";
import { validateData } from "@/lib/validation/resolver";

export type ValidationMode = "onChange" | "onBlur" | "onSubmit" | "all";

export interface UseRealtimeValidationOptions {
  /** When to trigger validation (default: "onBlur") */
  mode?: ValidationMode;
  /** Debounce delay in ms for onChange validation (default: 300) */
  debounceMs?: number;
  /** Custom error message formatter */
  formatError?: (fieldName: string, error: string) => string;
  /** Callback fired when validation state changes */
  onValidationChange?: (isValid: boolean, errors: Record<string, string>) => void;
}

export interface FieldValidationState {
  error: string | null;
  isValidated: boolean;
  isValidating: boolean;
  touched: boolean;
}

export interface UseRealtimeValidationResult<T> {
  /** Field registration function */
  register: (fieldName: keyof T) => {
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
    name: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  };
  /** Field-level errors */
  errors: Record<keyof T, string | null>;
  /** Fields that have been successfully validated */
  validatedFields: Set<keyof T>;
  /** Fields currently being validated (async) */
  validatingFields: Set<keyof T>;
  /** Whether any field is currently validating */
  isValidating: boolean;
  /** Manually trigger validation for a specific field */
  validateField: (fieldName: keyof T, value: unknown) => Promise<boolean>;
  /** Validate all fields */
  validateAll: (values: Partial<T>) => Promise<boolean>;
  /** Clear errors for a field */
  clearError: (fieldName: keyof T) => void;
  /** Clear all errors */
  clearAllErrors: () => void;
  /** Get validation state for a field */
  getFieldState: (fieldName: keyof T) => FieldValidationState;
  /** Whether the entire form is valid */
  isValid: boolean;
}

export function useRealtimeValidation<T extends Record<string, unknown>>(
  schema: ZodSchema,
  schemaName: string,
  options: UseRealtimeValidationOptions = {}
): UseRealtimeValidationResult<T> {
  const {
    mode = "onBlur",
    debounceMs = 300,
    formatError,
    onValidationChange,
  } = options;

  const [errors, setErrors] = useState<Record<keyof T, string | null>>({} as Record<keyof T, string | null>);
  const [validatedFields, setValidatedFields] = useState<Set<keyof T>>(new Set());
  const [validatingFields, setValidatingFields] = useState<Set<keyof T>>(new Set());
  const [touchedFields, setTouchedFields] = useState<Set<keyof T>>(new Set());
  const [fieldValues, setFieldValues] = useState<Partial<T>>({});

  const debounceTimers = useRef<Map<keyof T, NodeJS.Timeout>>(new Map());
  const isValid = Object.values(errors).every((e) => !e) && validatedFields.size > 0;

  // Notify on validation state changes
  useEffect(() => {
    if (onValidationChange) {
      const errorObj = Object.fromEntries(
        Object.entries(errors).filter(([_, v]) => v !== null)
      ) as Record<string, string>;
      onValidationChange(isValid, errorObj);
    }
  }, [isValid, errors, onValidationChange]);

  const validateField = useCallback(
    async (fieldName: keyof T, value: unknown): Promise<boolean> => {
      // Mark as validating
      setValidatingFields((prev) => new Set([...prev, fieldName]));

      try {
        // Validate the single field
        const fieldSchema = (schema as any).shape?.[fieldName];
        if (!fieldSchema) {
          console.warn(`Field ${String(fieldName)} not found in schema`);
          return true;
        }

        const result = fieldSchema.safeParse(value);

        if (result.success) {
          setErrors((prev) => ({ ...prev, [fieldName]: null }));
          setValidatedFields((prev) => new Set([...prev, fieldName]));
          return true;
        } else {
          const errorMessage = result.error.issues[0]?.message || "Validation failed";
          const formattedError = formatError
            ? formatError(String(fieldName), errorMessage)
            : errorMessage;

          setErrors((prev) => ({ ...prev, [fieldName]: formattedError }));
          setValidatedFields((prev) => {
            const next = new Set(prev);
            next.delete(fieldName);
            return next;
          });
          return false;
        }
      } catch (error) {
        console.error(`Validation error for ${String(fieldName)}:`, error);
        setErrors((prev) => ({ ...prev, [fieldName]: "Validation error" }));
        return false;
      } finally {
        setValidatingFields((prev) => {
          const next = new Set(prev);
          next.delete(fieldName);
          return next;
        });
      }
    },
    [schema, formatError]
  );

  const validateAll = useCallback(
    async (values: Partial<T>): Promise<boolean> => {
      const result = validateData<T>(schema, schemaName, values, "validate-all");

      if (result.success) {
        setErrors({} as Record<keyof T, string | null>);
        setValidatedFields(new Set(Object.keys(values) as (keyof T)[]));
        return true;
      } else {
        const formattedErrors = Object.fromEntries(
          Object.entries(result.errors).map(([field, error]) => [
            field,
            formatError ? formatError(field, error) : error,
          ])
        ) as Record<keyof T, string>;
        
        setErrors(formattedErrors as Record<keyof T, string | null>);
        setValidatedFields(new Set());
        return false;
      }
    },
    [schema, schemaName, formatError]
  );

  const clearError = useCallback((fieldName: keyof T) => {
    setErrors((prev) => ({ ...prev, [fieldName]: null }));
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrors({} as Record<keyof T, string | null>);
    setValidatedFields(new Set());
  }, []);

  const handleChange = useCallback(
    (fieldName: keyof T, value: string) => {
      // Update field value
      setFieldValues((prev) => ({ ...prev, [fieldName]: value }));

      // Clear existing debounce timer
      const existingTimer = debounceTimers.current.get(fieldName);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Validate on change if mode requires it
      if (mode === "onChange" || mode === "all") {
        const timer = setTimeout(() => {
          void validateField(fieldName, value);
          debounceTimers.current.delete(fieldName);
        }, debounceMs);

        debounceTimers.current.set(fieldName, timer);
      }
    },
    [mode, debounceMs, validateField]
  );

  const handleBlur = useCallback(
    (fieldName: keyof T) => {
      setTouchedFields((prev) => new Set([...prev, fieldName]));

      // Validate on blur if mode requires it
      if (mode === "onBlur" || mode === "all") {
        const value = fieldValues[fieldName];
        void validateField(fieldName, value);
      }
    },
    [mode, fieldValues, validateField]
  );

  const register = useCallback(
    (fieldName: keyof T) => {
      const hasError = !!errors[fieldName];
      const errorId = hasError ? `${String(fieldName)}-error` : undefined;

      return {
        name: String(fieldName),
        onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          handleChange(fieldName, e.target.value);
        },
        onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
          handleBlur(fieldName);
        },
        "aria-invalid": hasError,
        "aria-describedby": errorId,
      };
    },
    [errors, handleChange, handleBlur]
  );

  const getFieldState = useCallback(
    (fieldName: keyof T): FieldValidationState => ({
      error: errors[fieldName] || null,
      isValidated: validatedFields.has(fieldName),
      isValidating: validatingFields.has(fieldName),
      touched: touchedFields.has(fieldName),
    }),
    [errors, validatedFields, validatingFields, touchedFields]
  );

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      debounceTimers.current.forEach((timer) => clearTimeout(timer));
      debounceTimers.current.clear();
    };
  }, []);

  return {
    register,
    errors,
    validatedFields,
    validatingFields,
    isValidating: validatingFields.size > 0,
    validateField,
    validateAll,
    clearError,
    clearAllErrors,
    getFieldState,
    isValid,
  };
}
