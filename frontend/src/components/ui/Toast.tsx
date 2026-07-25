"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  /** Optional error code shown below the message for error toasts */
  code?: string;
  duration?: number;
}

// ─── Singleton event bus ──────────────────────────────────────────────────────

type ToastListener = (toast: ToastItem) => void;
type DismissListener = (id: string) => void;

const addListeners: Set<ToastListener> = new Set();
const dismissListeners: Set<DismissListener> = new Set();

function emitAdd(toast: ToastItem) {
  addListeners.forEach((fn) => fn(toast));
}

function emitDismiss(id: string) {
  dismissListeners.forEach((fn) => fn(id));
}

let counter = 0;

// ─── Public toast API ─────────────────────────────────────────────────────────

/**
 * Imperative toast helper — can be called outside React components.
 *
 * @example
 * toast.success("Settings saved");
 * toast.error("Failed to save", "ERR_500");
 */
export const toast = {
  success(message: string, duration = 4000) {
    emitAdd({ id: `t-${++counter}`, variant: "success", message, duration });
  },
  error(message: string, code?: string, duration = 6000) {
    emitAdd({ id: `t-${++counter}`, variant: "error", message, code, duration });
  },
  warning(message: string, duration = 4000) {
    emitAdd({ id: `t-${++counter}`, variant: "warning", message, duration });
  },
  info(message: string, duration = 4000) {
    emitAdd({ id: `t-${++counter}`, variant: "info", message, duration });
  },
};

// ─── useToast hook ────────────────────────────────────────────────────────────

/** Returns the same imperative toast API bound to the active ToastContainer. */
export function useToast() {
  return toast;
}

// ─── Individual toast item ────────────────────────────────────────────────────

const VARIANT_CONFIG: Record<
  ToastVariant,
  { icon: React.ReactNode; bg: string; border: string; text: string }
> = {
  success: {
    icon: <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden="true" />,
    bg: "bg-background",
    border: "border-green-500/40",
    text: "text-foreground",
  },
  error: {
    icon: <XCircle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />,
    bg: "bg-background",
    border: "border-destructive/40",
    text: "text-foreground",
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5 shrink-0 text-yellow-500" aria-hidden="true" />,
    bg: "bg-background",
    border: "border-yellow-500/40",
    text: "text-foreground",
  },
  info: {
    icon: <Info className="h-5 w-5 shrink-0 text-blue-500" aria-hidden="true" />,
    bg: "bg-background",
    border: "border-blue-500/40",
    text: "text-foreground",
  },
};

interface ToastItemComponentProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
}

function ToastItemComponent({ item, onDismiss }: ToastItemComponentProps) {
  const { icon, bg, border, text } = VARIANT_CONFIG[item.variant];
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(() => onDismiss(item.id), item.duration ?? 4000);
    return () => clearTimeout(timerRef.current);
  }, [item.id, item.duration, onDismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.95 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      role="alert"
      aria-live="polite"
      className={`flex items-start gap-3 w-full max-w-sm rounded-lg border shadow-lg px-4 py-3 ${bg} ${border}`}
    >
      {icon}
      <div className={`flex-1 min-w-0 ${text}`}>
        <p className="text-sm font-medium leading-snug">{item.message}</p>
        {item.code && (
          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
            Code: {item.code}
          </p>
        )}
      </div>
      <button
        onClick={() => onDismiss(item.id)}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors -mr-1"
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}

// ─── ToastContainer ───────────────────────────────────────────────────────────

/**
 * Renders all active toasts in a fixed bottom-right stack.
 * Mount once near the root of your app (e.g. in layout.tsx).
 */
export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  const handleAdd = useCallback((item: ToastItem) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    emitDismiss(id);
  }, []);

  useEffect(() => {
    addListeners.add(handleAdd);
    return () => {
      addListeners.delete(handleAdd);
    };
  }, [handleAdd]);

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 w-full max-w-sm pointer-events-none"
    >
      <AnimatePresence mode="sync">
        {items.map((item) => (
          <div key={item.id} className="pointer-events-auto">
            <ToastItemComponent item={item} onDismiss={handleDismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
