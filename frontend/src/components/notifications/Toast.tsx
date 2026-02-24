"use client";

import { useEffect } from "react";
import { X, CheckCircle, Info, AlertTriangle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToastNotification, NotificationType } from "@/types/notification";
import { useNotifications } from "@/contexts/NotificationContext";
import { Button } from "@/components/ui/Button";

const typeConfig: Record<
  NotificationType,
  { icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  info: { icon: Info, className: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
  success: { icon: CheckCircle, className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  warning: { icon: AlertTriangle, className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
  error: { icon: AlertCircle, className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" },
  match: { icon: CheckCircle, className: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20" },
};

function ToastItem({ toast }: { toast: ToastNotification }) {
  const { removeToast } = useNotifications();
  const config = typeConfig[toast.type] ?? typeConfig.info;
  const Icon = config.icon;

  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const t = setTimeout(() => removeToast(toast.id), toast.duration);
      return () => clearTimeout(t);
    }
  }, [toast.id, toast.duration, removeToast]);

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 shadow-lg backdrop-blur-sm animate-in slide-in-from-right-full duration-300",
        config.className
      )}
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{toast.title}</p>
        {toast.message && (
          <p className="mt-0.5 text-sm opacity-90">{toast.message}</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 h-8 w-8 p-0 opacity-70 hover:opacity-100"
        onClick={() => removeToast(toast.id)}
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts } = useNotifications();

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
    >
      <div className="flex flex-col gap-2 pointer-events-auto">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} />
        ))}
      </div>
    </div>
  );
}
