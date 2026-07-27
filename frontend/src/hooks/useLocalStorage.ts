"use client";

/**
 * useLocalStorage — persistent state backed by localStorage with
 * cross-tab sync, SSR safety, and optional JSON schema validation.
 *
 * Features:
 *  - Reads initial value from localStorage on mount (SSR-safe)
 *  - Writes on every state change
 *  - Syncs across browser tabs via the `storage` event
 *  - Accepts a validator to reject stale / malformed stored values
 *  - Exposes `remove()` to clear the key
 *
 * @example
 * const [theme, setTheme, removeTheme] = useLocalStorage("theme", "dark");
 */

import { useState, useEffect, useCallback, useRef } from "react";

type Serializable =
  | string
  | number
  | boolean
  | null
  | Serializable[]
  | { [key: string]: Serializable };

export interface UseLocalStorageOptions<T> {
  /**
   * Optional guard function. If it returns false the stored value is
   * discarded and the initialValue is used instead.
   */
  validate?: (value: unknown) => value is T;
  /**
   * Serializer — defaults to JSON.stringify / JSON.parse.
   */
  serialize?: (value: T) => string;
  deserialize?: (raw: string) => T;
}

function defaultSerializer<T>(value: T): string {
  return JSON.stringify(value);
}

function defaultDeserializer<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

/**
 * Reads a value from localStorage, applying the optional validator.
 * Returns null if the key is absent, the value is invalid JSON, or the
 * validator rejects it.
 */
function readStorage<T>(
  key: string,
  deserialize: (raw: string) => T,
  validate?: (v: unknown) => v is T
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = deserialize(raw);
    if (validate && !validate(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  options: UseLocalStorageOptions<T> = {}
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const {
    validate,
    serialize = defaultSerializer,
    deserialize = defaultDeserializer,
  } = options;

  const serializeRef = useRef(serialize);
  const deserializeRef = useRef(deserialize);
  serializeRef.current = serialize;
  deserializeRef.current = deserialize;

  const [storedValue, setStoredValue] = useState<T>(() => {
    const stored = readStorage<T>(key, deserializeRef.current, validate);
    return stored !== null ? stored : initialValue;
  });

  // Write to localStorage when value changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, serializeRef.current(storedValue));
    } catch {
      // Quota exceeded or private browsing — silently ignore
    }
  }, [key, storedValue]);

  // Sync across tabs
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key || event.storageArea !== window.localStorage) return;
      if (event.newValue === null) {
        setStoredValue(initialValue);
        return;
      }
      try {
        const parsed = deserializeRef.current(event.newValue);
        if (validate && !validate(parsed)) return;
        setStoredValue(parsed);
      } catch {
        // Ignore malformed cross-tab updates
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [key, initialValue, validate]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) =>
        typeof value === "function"
          ? (value as (prev: T) => T)(prev)
          : value
      );
    },
    []
  );

  const remove = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(key);
    }
    setStoredValue(initialValue);
  }, [key, initialValue]);

  return [storedValue, setValue, remove];
}
