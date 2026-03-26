"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  PersistentNotification,
  ToastNotification,
  NotificationType,
} from "@/types/notification";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const PERSISTENT_STORAGE_KEY = "arenax_notifications";
const MAX_LOCAL_NOTIFICATIONS = 50;

interface NotificationContextType {
  // Persistent notifications (from API or localStorage fallback)
  persistentNotifications: PersistentNotification[];
  unreadCount: number;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  removeNotification: (id: string) => void;
  refreshNotifications: () => Promise<void>;

  // Ephemeral toasts
  toasts: ToastNotification[];
  addToast: (
    toast: Omit<ToastNotification, "id" | "createdAt"> & { id?: string }
  ) => void;
  removeToast: (id: string) => void;

  // Convenience: add both persistent (when API available) and show toast
  notify: (params: {
    type?: NotificationType;
    title: string;
    message?: string;
    link?: string;
    linkLabel?: string;
    persistent?: boolean;
    toast?: boolean;
    toastDuration?: number;
  }) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(
  undefined
);

function loadLocalNotifications(): PersistentNotification[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(PERSISTENT_STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as PersistentNotification[];
    return Array.isArray(parsed)
      ? parsed.slice(0, MAX_LOCAL_NOTIFICATIONS)
      : [];
  } catch {
    return [];
  }
}

function saveLocalNotifications(notifications: PersistentNotification[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      PERSISTENT_STORAGE_KEY,
      JSON.stringify(notifications.slice(0, MAX_LOCAL_NOTIFICATIONS))
    );
  } catch {
    // Ignore storage errors
  }
}

function generateId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [persistentNotifications, setPersistentNotifications] = useState<
    PersistentNotification[]
  >(loadLocalNotifications);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const toastTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const unreadCount = persistentNotifications.filter((n) => !n.read).length;

  const refreshNotifications = useCallback(async () => {
    if (!user?.id) {
      setPersistentNotifications(loadLocalNotifications());
      return;
    }
    try {
      const data = await api.getNotifications();
      if (Array.isArray(data)) {
        const mapped: PersistentNotification[] = data.map((n) => ({
          ...n,
          type: (n.type as PersistentNotification["type"]) ?? "info",
        }));
        setPersistentNotifications(mapped);
      }
    } catch {
      setPersistentNotifications(loadLocalNotifications());
    }
  }, [user?.id]);

  useEffect(() => {
    refreshNotifications();
    const interval = setInterval(refreshNotifications, 60_000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  const markAsRead = useCallback(
    (id: string) => {
      setPersistentNotifications((prev) => {
        const updated = prev.map((n) =>
          n.id === id ? { ...n, read: true } : n
        );
        if (user?.id) {
          api.markNotificationRead(id).catch(() => {});
        } else {
          saveLocalNotifications(updated);
        }
        return updated;
      });
    },
    [user?.id]
  );

  const markAllAsRead = useCallback(() => {
    setPersistentNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      if (user?.id) {
        api.markAllNotificationsRead().catch(() => {});
      } else {
        saveLocalNotifications(updated);
      }
      return updated;
    });
  }, [user?.id]);

  const removeNotification = useCallback(
    (id: string) => {
      setPersistentNotifications((prev) => {
        const updated = prev.filter((n) => n.id !== id);
        if (user?.id) {
          api.deleteNotification(id).catch(() => {});
        } else {
          saveLocalNotifications(updated);
        }
        return updated;
      });
    },
    [user?.id]
  );

  const addToast = useCallback(
    (toast: Omit<ToastNotification, "id" | "createdAt"> & { id?: string }) => {
      const id = toast.id ?? generateId();
      const fullToast: ToastNotification = {
        ...toast,
        id,
        createdAt: Date.now(),
        duration: toast.duration ?? 5000,
      };
      setToasts((prev) => [...prev.filter((t) => t.id !== id), fullToast]);

      if (fullToast.duration && fullToast.duration > 0) {
        const timeout = setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
          toastTimeouts.current.delete(id);
        }, fullToast.duration);
        toastTimeouts.current.set(id, timeout);
      }
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    const timeout = toastTimeouts.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      toastTimeouts.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (params: {
      type?: NotificationType;
      title: string;
      message?: string;
      link?: string;
      linkLabel?: string;
      persistent?: boolean;
      toast?: boolean;
      toastDuration?: number;
    }) => {
      const {
        type = "info",
        title,
        message,
        link,
        linkLabel,
        persistent = false,
        toast: showToast = true,
        toastDuration = 5000,
      } = params;

      if (showToast) {
        addToast({ type, title, message, duration: toastDuration });
      }

      if (persistent) {
        const persistentNotif: PersistentNotification = {
          id: generateId(),
          type,
          title,
          message: message ?? "",
          link,
          linkLabel,
          read: false,
          createdAt: new Date().toISOString(),
        };
        setPersistentNotifications((prev) => {
          const updated = [persistentNotif, ...prev];
          if (user?.id) {
            api.createNotification({
              type,
              title,
              message: message ?? "",
              link,
              linkLabel,
            }).catch(() => saveLocalNotifications(updated));
          } else {
            saveLocalNotifications(updated);
          }
          return updated;
        });
      }
    },
    [addToast, user?.id]
  );

  const value: NotificationContextType = {
    persistentNotifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    refreshNotifications,
    toasts,
    addToast,
    removeToast,
    notify,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
