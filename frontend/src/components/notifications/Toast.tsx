"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { X, CheckCircle, Info, AlertTriangle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToastNotification, NotificationType, ToastPosition } from "@/types/notification";
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

const positionClasses: Record<ToastPosition, string> = {
  "top-left": "top-4 left-4",
  "top-center": "top-4 left-1/2 -translate-x-1/2",
  "top-right": "top-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
  "bottom-right": "bottom-4 right-4",
};

const SWIPE_THRESHOLD = 100;

function ToastItem({ toast }: { toast: ToastNotification }) {
  const { removeToast } = useNotifications();
  const config = typeConfig[toast.type] ?? typeConfig.info;
  const Icon = config.icon;
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const progressRef = useRef(progress);
  const startTimeRef = useRef(Date.now());
  const x = useMotionValue(0);
  const opacity = useTransform(x, [-200, 0, 200], [0, 1, 0]);
  const rotate = useTransform(x, [-200, 0, 200], [-15, 0, 15]);

  progressRef.current = progress;

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) return;

    const interval = setInterval(() => {
      if (!isPaused) {
        const elapsed = Date.now() - startTimeRef.current;
        const remaining = Math.max(0, 100 - (elapsed / toast.duration) * 100);
        setProgress(remaining);

        if (remaining <= 0) {
          clearInterval(interval);
          removeToast(toast.id);
        }
      }
    }, 16);

    return () => clearInterval(interval);
  }, [toast.duration, toast.id, removeToast, isPaused]);

  const handleDragEnd = (_: any, info: PanInfo) => {
    if (Math.abs(info.offset.x) > SWIPE_THRESHOLD) {
      removeToast(toast.id);
    } else {
      x.set(0);
    }
  };

  const position = toast.position ?? "bottom-right";

  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: position.startsWith("top") ? -50 : 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      style={{ x, opacity, rotate }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={cn(
        "relative flex items-start gap-3 rounded-lg border p-4 shadow-lg backdrop-blur-sm pointer-events-auto select-none touch-pan-y",
        config.className
      )}
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{toast.title}</p>
        {toast.message && (
          <p className="mt-0.5 text-sm opacity-90">{toast.message}</p>
        )}
        {toast.action && (
          <Button
            variant="link"
            size="sm"
            className="mt-2 h-auto p-0 text-sm font-medium"
            onClick={toast.action.onClick}
          >
            {toast.action.label}
          </Button>
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
      {toast.showProgress && toast.duration && toast.duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-current opacity-20 rounded-b-lg overflow-hidden">
          <motion.div
            className="h-full bg-current"
            initial={{ width: "100%" }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.016 }}
          />
        </div>
      )}
    </motion.div>
  );
}

export function ToastContainer() {
  const { toasts } = useNotifications();

  if (toasts.length === 0) return null;

  const groupedToasts = toasts.reduce((acc, toast) => {
    const position = toast.position ?? "bottom-right";
    if (!acc[position]) {
      acc[position] = [];
    }
    acc[position].push(toast);
    return acc;
  }, {} as Record<ToastPosition, ToastNotification[]>);

  return (
    <>
      {Object.entries(groupedToasts).map(([position, positionToasts]) => (
        <div
          key={position}
          className={cn(
            "fixed z-[100] flex flex-col gap-3 max-w-sm w-full pointer-events-none",
            positionClasses[position as ToastPosition]
          )}
          aria-live="polite"
          aria-label="Notifications"
        >
          <div className="flex flex-col gap-3 pointer-events-auto">
            {positionToasts.map((toast) => (
              <ToastItem key={toast.id} toast={toast} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
