"use client";

/**
 * CopyButton — copies a value with toast feedback (Issue #1336).
 *
 * - Copies the full `value`, even when the surrounding UI shows it truncated.
 * - Clipboard API first, hidden-textarea fallback on insecure origins.
 * - Success → toast (e.g. "Wallet address copied") + check icon for ~2s.
 * - Failure → error toast and an inline, pre-selected read-only field so the
 *   user can copy manually (Ctrl/Cmd+C).
 * - Native <button>: focusable, activates with Enter/Space, and carries a
 *   descriptive `aria-label`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/contexts/ToastContext";

export interface CopyButtonProps {
  /** Full value to copy. */
  value: string;
  /** What is being copied, used in the aria-label and toasts (e.g. "wallet address"). */
  label?: string;
  /** Toast shown on success. Defaults to "<Label> copied". */
  successMessage?: string;
  /** Show a text label next to the icon. */
  showText?: boolean;
  size?: "sm" | "md";
  className?: string;
  /** Called after a successful copy. */
  onCopied?: (value: string) => void;
}

const RESET_AFTER_MS = 2000;

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function CopyButton({
  value,
  label = "value",
  successMessage,
  showText = false,
  size = "sm",
  className,
  onCopied,
}: CopyButtonProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  // Pre-select the manual fallback so Ctrl/Cmd+C works immediately.
  useEffect(() => {
    if (!showManual) return;
    manualInputRef.current?.focus();
    manualInputRef.current?.select();
  }, [showManual]);

  const handleCopy = useCallback(async () => {
    if (!value) return;
    try {
      await copyToClipboard(value);
      setShowManual(false);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), RESET_AFTER_MS);
      toast.success(successMessage ?? `${capitalize(label)} copied`, {
        title: "Copied to clipboard",
      });
      onCopied?.(value);
    } catch {
      setShowManual(true);
      toast.error(
        `Couldn't copy the ${label} automatically. It's selected next to the button — press Ctrl+C (⌘C on Mac) to copy it.`,
        { title: "Copy failed" },
      );
    }
  }, [value, label, successMessage, toast, onCopied]);

  const iconClass = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleCopy}
        disabled={!value}
        aria-label={copied ? `${capitalize(label)} copied` : `Copy ${label}`}
        title={copied ? "Copied" : `Copy ${label}`}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md text-muted-foreground transition-colors",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          size === "sm" ? "p-1 text-xs" : "px-2 py-1.5 text-sm",
          copied && "text-emerald-600 dark:text-emerald-400",
          className,
        )}
      >
        {copied ? (
          <Check className={iconClass} aria-hidden="true" />
        ) : (
          <Copy className={iconClass} aria-hidden="true" />
        )}
        {showText && <span>{copied ? "Copied" : "Copy"}</span>}
      </button>

      {showManual && (
        <input
          ref={manualInputRef}
          type="text"
          readOnly
          value={value}
          aria-label={`${capitalize(label)} — press Ctrl+C to copy`}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => setShowManual(false)}
          className="w-40 rounded border bg-background px-1.5 py-0.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      )}
    </span>
  );
}

export default CopyButton;
