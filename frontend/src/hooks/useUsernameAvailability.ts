"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";

export type UsernameAvailabilityStatus =
  | "idle"
  | "checking"
  | "available"
  | "unavailable"
  | "error";

const USERNAME_REGEX = /^[a-zA-Z0-9]+$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 20;
const DEBOUNCE_MS = 400;

export function useUsernameAvailability(username: string) {
  const [status, setStatus] = useState<UsernameAvailabilityStatus>("idle");
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear previous timer and abort any in-flight request
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();

    const trimmed = username.trim();

    if (
      trimmed.length < MIN_LENGTH ||
      trimmed.length > MAX_LENGTH ||
      !USERNAME_REGEX.test(trimmed)
    ) {
      setStatus("idle");
      return;
    }

    setStatus("checking");

    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await api.checkUsernameAvailability(trimmed);
        if (!controller.signal.aborted) {
          setStatus(result.available ? "available" : "unavailable");
        }
      } catch {
        if (!controller.signal.aborted) {
          setStatus("error");
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, [username]);

  return status;
}
