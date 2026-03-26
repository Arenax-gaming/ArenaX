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
  NotificationPreferences,
} from "@/types/notification";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

const PERSISTENT_STORAGE_KEY = "arenax_notifications";
const PREFERENCES_STORAGE_KEY = "arenax_notification_preferences";
const MAX_LOCAL_NOTIFICATIONS = 50;
const MAX_TOASTS = 4;

const DEFAULT_PREFERENCES: NotificationPreferences = {
  info: true,
  success: true,
  warning: true,
  error: true,
  match: true,
};

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

  // User preferences
  preferences: NotificationPreferences;
  updatePreference: (type: NotificationType, enabled: boolean) => void;
  setAllPreferences: (enabled: boolean) => void;
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

function loadPreferences(): NotificationPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<NotificationPreferences>;
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(preferences: NotificationPreferences) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
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
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    loadPreferences
  );
  const toastTimeouts = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const preferencesRef = useRef(preferences);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

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
        saveLocalNotifications(mapped);
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
        }
        saveLocalNotifications(updated);
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
      }
      saveLocalNotifications(updated);
      return updated;
    });
  }, [user?.id]);

  const removeNotification = useCallback(
    (id: string) => {
      setPersistentNotifications((prev) => {
        const updated = prev.filter((n) => n.id !== id);
        if (user?.id) {
          api.deleteNotification(id).catch(() => {});
        }
        saveLocalNotifications(updated);
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
      setToasts((prev) => {
        const next = [...prev.filter((t) => t.id !== id), fullToast];
        return next.slice(-MAX_TOASTS);
      });

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

      if (!preferencesRef.current[type]) return;

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
            }).catch(() => {});
          }
          saveLocalNotifications(updated);
          return updated;
        });
      }
    },
    [addToast, user?.id]
  );

  const updatePreference = useCallback(
    (type: NotificationType, enabled: boolean) => {
      setPreferences((prev) => {
        const next = { ...prev, [type]: enabled };
        savePreferences(next);
        return next;
      });
    },
    []
  );

  const setAllPreferences = useCallback((enabled: boolean) => {
    const next = Object.keys(DEFAULT_PREFERENCES).reduce((acc, key) => {
      acc[key as NotificationType] = enabled;
      return acc;
    }, {} as NotificationPreferences);
    setPreferences(next);
    savePreferences(next);
  }, []);

  const handleIncomingNotification = useCallback(
    (notification: PersistentNotification) => {
      if (!preferencesRef.current[notification.type]) return;

      setPersistentNotifications((prev) => {
        const next = [
          notification,
          ...prev.filter((existing) => existing.id !== notification.id),
        ];

        if (!user?.id) {
          saveLocalNotifications(next);
        }
        return next;
      });

      const allowToast = notification.metadata?.toast !== false;
      if (allowToast) {
        addToast({
          type: notification.type,
          title: notification.title,
          message: notification.message,
          duration: 5000,
        });
      }
    },
    [addToast, user?.id]
  );

  useEffect(() => {
    if (!user?.id || typeof window === "undefined") return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;
    let closed = false;

    const buildWsUrl = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const token =
        localStorage.getItem("auth_token") ??
        sessionStorage.getItem("auth_token");
      const qs = token ? `?token=${encodeURIComponent(token)}` : "";
      return `${protocol}://${window.location.host}/ws/notifications${qs}`;
    };

    const scheduleReconnect = () => {
      if (closed) return;
      const delay = Math.min(10000, 1000 * 2 ** retry);
      retry += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    const normalizeNotification = (input: any): PersistentNotification | null => {
      if (!input) return null;
      const candidate = input.notification ?? input.payload ?? input.data ?? input;
      if (!candidate) return null;

      const type = (candidate.type as NotificationType) ?? "info";
      const title =
        (candidate.title as string | undefined) ??
        (candidate.message as string | undefined) ??
        "Notification";

      return {
        id: (candidate.id as string | undefined) ?? generateId(),
        type,
        title,
        message: (candidate.message as string | undefined) ?? "",
        link: candidate.link as string | undefined,
        linkLabel: candidate.linkLabel as string | undefined,
        read: (candidate.read as boolean | undefined) ?? false,
        createdAt:
          (candidate.createdAt as string | undefined) ??
          new Date().toISOString(),
        metadata: candidate.metadata as Record<string, unknown> | undefined,
      };
    };

    const handleMessage = (raw: string) => {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.type === "ping") {
          ws?.send(JSON.stringify({ type: "pong" }));
          return;
        }
        const notification = normalizeNotification(parsed);
        if (notification) handleIncomingNotification(notification);
      } catch {
        // Ignore non-JSON messages
      }
    };

    const connect = () => {
      if (closed) return;
      try {
        ws = new WebSocket(buildWsUrl());
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        retry = 0;
      };
      ws.onmessage = (event) => handleMessage(event.data);
      ws.onclose = () => {
        if (closed) return;
        scheduleReconnect();
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [handleIncomingNotification, user?.id]);

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
    preferences,
    updatePreference,
    setAllPreferences,
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
