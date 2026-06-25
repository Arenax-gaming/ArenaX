"use client";

import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { LoggedError, logError } from "@/lib/errorLogger";

interface ErrorContextType {
  errors: LoggedError[];
  addError: (error: Error, metadata?: Record<string, unknown>) => LoggedError;
  clearErrors: () => void;
}

const ErrorContext = createContext<ErrorContextType | undefined>(undefined);

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<LoggedError[]>([]);

  const addError = useCallback((error: Error, metadata?: Record<string, unknown>) => {
    const loggedError = logError(error, metadata);
    setErrors((prev) => [loggedError, ...prev]);
    return loggedError;
  }, []);

  const clearErrors = useCallback(() => {
    setErrors([]);
  }, []);

  return (
    <ErrorContext.Provider value={{ errors, addError, clearErrors }}>
      {children}
    </ErrorContext.Provider>
  );
}

export function useError() {
  const context = useContext(ErrorContext);
  if (!context) {
    throw new Error("useError must be used within an ErrorProvider");
  }
  return context;
}
