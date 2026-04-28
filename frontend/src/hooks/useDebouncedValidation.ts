import { useState, useEffect, useCallback, useRef } from "react";
import { z } from "zod";

interface UseDebouncedValidationOptions<T> {
  schema: z.ZodSchema<T>;
  debounceMs?: number;
}

interface ValidationState<T> {
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  isValid: boolean;
}

export function useDebouncedValidation<T extends Record<string, unknown>>({
  schema,
  debounceMs = 300,
}: UseDebouncedValidationOptions<T>) {
  const [values, setValues] = useState<Partial<T>>({});
  const [validationState, setValidationState] = useState<ValidationState<T>>({
    errors: {},
    touched: {},
    isValid: false,
  });

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const validate = useCallback(
    (fieldValues?: Partial<T>) => {
      const valuesToValidate = fieldValues || values;
      const result = schema.safeParse(valuesToValidate);

      if (!result.success) {
        const errors: Partial<Record<keyof T, string>> = {};
        result.error.issues.forEach((issue) => {
          const path = issue.path[0] as keyof T;
          if (path && !errors[path]) {
            errors[path] = issue.message;
          }
        });
        setValidationState({
          errors,
          touched: Object.keys(valuesToValidate).reduce(
            (acc, key) => ({ ...acc, [key]: true }),
            {} as Partial<Record<keyof T, boolean>>
          ),
          isValid: false,
        });
        return false;
      }

      setValidationState({
        errors: {},
        touched: Object.keys(valuesToValidate).reduce(
          (acc, key) => ({ ...acc, [key]: true }),
          {} as Partial<Record<keyof T, boolean>>
        ),
        isValid: true,
      });
      return true;
    },
    [schema, values]
  );

  const setFieldValue = useCallback(
    (field: keyof T, value: unknown) => {
      setValues((prev) => {
        const newValues = { ...prev, [field]: value };

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
          validate(newValues as Partial<T>);
        }, debounceMs);

        return newValues;
      });
    },
    [validate, debounceMs]
  );

  const setFieldTouched = useCallback((field: keyof T) => {
    setValidationState((prev) => ({
      ...prev,
      touched: { ...prev.touched, [field]: true },
    }));
  }, []);

  const resetValidation = useCallback(() => {
    setValues({});
    setValidationState({
      errors: {},
      touched: {},
      isValid: false,
    });
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const getFieldError = useCallback(
    (field: keyof T): string | undefined => {
      return validationState.touched[field] ? validationState.errors[field] : undefined;
    },
    [validationState.errors, validationState.touched]
  );

  const getFieldSuccess = useCallback(
    (field: keyof T): boolean => {
      return (
        validationState.touched[field] === true &&
        !validationState.errors[field] &&
        values[field] !== undefined &&
        values[field] !== ""
      );
    },
    [validationState.errors, validationState.touched, values]
  );

  return {
    values,
    errors: validationState.errors,
    touched: validationState.touched,
    isValid: validationState.isValid,
    setFieldValue,
    setFieldTouched,
    validate,
    resetValidation,
    getFieldError,
    getFieldSuccess,
  };
}
