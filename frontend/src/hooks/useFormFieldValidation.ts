import { useState, useEffect, useCallback } from "react";
import { ZodSchema, ZodError } from "zod";
import { useDebounce } from "./useDebounce";

export interface FieldValidationState {
  isValid: boolean | null; // null = not validated yet
  error: string | null;
  isDirty: boolean;
  isTouched: boolean;
}

export interface UseFormFieldValidationProps<T> {
  value: string;
  schema: ZodSchema;
  fieldName: keyof T;
  delay?: number;
}

export function useFormFieldValidation<T>({
  value,
  schema,
  fieldName,
  delay = 400,
}: UseFormFieldValidationProps<T>): FieldValidationState {
  const [state, setState] = useState<FieldValidationState>({
    isValid: null,
    error: null,
    isDirty: false,
    isTouched: false,
  });

  const debouncedValue = useDebounce(value, delay);

  const validateField = useCallback(
    (val: string) => {
      if (!val || val.trim() === "") {
        setState({
          isValid: null,
          error: null,
          isDirty: state.isDirty,
          isTouched: state.isTouched,
        });
        return;
      }

      try {
        // Create a partial schema for just this field
        const fieldSchema = schema.shape[fieldName];
        fieldSchema.parse(val);

        setState({
          isValid: true,
          error: null,
          isDirty: true,
          isTouched: true,
        });
      } catch (error) {
        if (error instanceof ZodError) {
          const firstError = error.errors[0];
          setState({
            isValid: false,
            error: firstError.message,
            isDirty: true,
            isTouched: true,
          });
        }
      }
    },
    [schema, fieldName, state.isDirty, state.isTouched]
  );

  // Mark as touched on first change
  useEffect(() => {
    if (value && !state.isTouched) {
      setState((prev) => ({ ...prev, isTouched: true, isDirty: true }));
    }
  }, [value, state.isTouched]);

  // Validate on debounced value change
  useEffect(() => {
    if (state.isTouched) {
      validateField(debouncedValue);
    }
  }, [debouncedValue, validateField, state.isTouched]);

  return state;
}
