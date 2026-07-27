"use client";

/**
 * useClipboard — copy text to the clipboard with feedback state.
 *
 * Features:
 *  - Uses the modern Clipboard API with a document.execCommand fallback
 *  - Provides a `hasCopied` flag that auto-resets after a configurable delay
 *  - Tracks the last copied value
 *
 * @example
 * const { copy, hasCopied, value } = useClipboard();
 * <button onClick={() => copy(shareUrl)}>
 *   {hasCopied ? "Copied!" : "Share"}
 * </button>
 */

import { useState, useCallback, useRef } from "react";

export interface UseClipboardOptions {
  /** How long the `hasCopied` flag stays true in ms (default 2000). */
  resetAfterMs?: number;
}

export interface UseClipboardResult {
  /** Copy the given text to the clipboard. Returns true on success. */
  copy: (text: string) => Promise<boolean>;
  /** True for `resetAfterMs` ms after a successful copy. */
  hasCopied: boolean;
  /** The last value that was successfully copied (null before first copy). */
  value: string | null;
  /** Any error from the last copy attempt. */
  error: Error | null;
}

export function useClipboard(
  options: UseClipboardOptions = {}
): UseClipboardResult {
  const { resetAfterMs = 2000 } = options;
  const [hasCopied, setHasCopied] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      setError(null);

      // Modern Clipboard API
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          setValue(text);
          setHasCopied(true);
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(
            () => setHasCopied(false),
            resetAfterMs
          );
          return true;
        } catch (caught) {
          const err =
            caught instanceof Error ? caught : new Error("Clipboard write failed");
          setError(err);
          return false;
        }
      }

      // Legacy fallback (execCommand)
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.cssText =
          "position:fixed;top:0;left:0;opacity:0;pointer-events:none;";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!ok) throw new Error("execCommand copy failed");
        setValue(text);
        setHasCopied(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(
          () => setHasCopied(false),
          resetAfterMs
        );
        return true;
      } catch (caught) {
        const err =
          caught instanceof Error ? caught : new Error("Clipboard copy failed");
        setError(err);
        return false;
      }
    },
    [resetAfterMs]
  );

  return { copy, hasCopied, value, error };
}
