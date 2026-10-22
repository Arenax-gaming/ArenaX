"use client";

/**
 * ToastContext — one toast API for components (Issue #1336).
 *
 * Inside the app shell, toasts go through `NotificationContext` so they render
 * in the global `ToastContainer` and respect the user's notification
 * preferences. Outside it (isolated pages, Storybook, tests) they fall back to
 * the standalone `components/ui/Toast` event bus, so callers never need to
 * know which one is mounted.
 *
 * @example
 * const toast = useToast();
 * toast.success("Wallet address copied");
 * toast.error("Couldn't send friend request", { title: "Request failed" });
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { NotificationContext } from "@/contexts/NotificationContext";
import { toast as standaloneToast } from "@/components/ui/Toast";
import type { NotificationType, ToastAction } from "@/types/notification";

export interface ToastOptions {
  /** Heading shown above the message (defaults to a per-variant title). */
  title?: string;
  /** Auto-dismiss delay in ms. */
  duration?: number;
  action?: ToastAction;
}

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastApi {
  show: (variant: ToastVariant, message: string, options?: ToastOptions) => void;
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
}

const DEFAULT_TITLES: Record<ToastVariant, string> = {
  success: "Success",
  error: "Something went wrong",
  warning: "Heads up",
  info: "Info",
};

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  success: 3000,
  error: 6000,
  warning: 5000,
  info: 4000,
};

function buildApi(show: ToastApi["show"]): ToastApi {
  return {
    show,
    success: (message, options) => show("success", message, options),
    error: (message, options) => show("error", message, options),
    warning: (message, options) => show("warning", message, options),
    info: (message, options) => show("info", message, options),
  };
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Optional override, e.g. to capture toasts in tests. Without it `useToast`
 * picks the notification system or the standalone fallback automatically.
 */
export function ToastProvider({
  value,
  children,
}: {
  value: ToastApi;
  children: ReactNode;
}) {
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const override = useContext(ToastContext);
  const notifications = useContext(NotificationContext);
  const addToast = notifications?.addToast;

  return useMemo(() => {
    if (override) return override;

    if (addToast) {
      return buildApi((variant, message, options = {}) => {
        addToast({
          type: variant as NotificationType,
          title: options.title ?? DEFAULT_TITLES[variant],
          message,
          duration: options.duration ?? DEFAULT_DURATIONS[variant],
          action: options.action,
        });
      });
    }

    return buildApi((variant, message, options = {}) => {
      const duration = options.duration ?? DEFAULT_DURATIONS[variant];
      if (variant === "error") {
        standaloneToast.error(message, undefined, duration);
      } else {
        standaloneToast[variant](message, duration);
      }
    });
  }, [override, addToast]);
}
