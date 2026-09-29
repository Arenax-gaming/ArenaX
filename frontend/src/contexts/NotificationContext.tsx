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
  ToastPosition,
  ToastAction,
} from "@/types/notification";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { alertUser } from "@/lib/notificationAlerts";

const PERSISTENT_STORAGE_KEY = "arenax_notifications";
const PREFERENCES_STORAGE_KEY = "arenax_notification_preferences";
const MUTE_STORAGE_KEY = "arenax_notification_muted";

/**
 * Channel other tabs of this origin listen on (Issue #886).
 *
 * Only one tab holds the notification WebSocket at a time in practice, so a
 * badge that updates only in that tab leaves every other tab stale until it is
 * refreshed. Rebroadcasting each arrival keeps the count identical everywhere
 * without opening a socket per tab.
 */
const SYNC_CHANNEL = "arenax:notifications";
const MAX_LOCAL_NOTIFICATIONS = 50;
const MAX_TOASTS = 4;
const NOTIFICATIONS_PAGE_SIZE = 20;

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
  refreshNotifications: (options?: {
    offset?: number;
    limit?: number;
    append?: boolean;
  }) => Promise<void>;
  hasMoreNotifications: boolean;
  loadMoreNotifications: () => Promise<void>;

  // Ephemeral toasts
  toasts: ToastNotification[];
  addToast: (
    toast: Omit<ToastNotification, "id" | "createdAt"> & { id?: string }
  ) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;

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
    toastPosition?: ToastPosition;
    toastAction?: ToastAction;
    showProgress?: boolean;
  }) => void;

  // User preferences
  preferences: NotificationPreferences;
  updatePreference: (type: NotificationType, enabled: boolean) => void;
  setAllPreferences: (enabled: boolean) => void;

  /** Sound and vibration alerts silenced for this browser (Issue #886). */
  alertsMuted: boolean;
  toggleAlertsMuted: () => void;
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

/**
 * Sound/vibration mute, per browser profile.
 *
 * Stored separately from `NotificationPreferences`, which decides *whether a
 * notification is shown at all*. Muting is about how loudly an arrival is
 * announced — a user who wants match alerts but not a chime in an open-plan
 * office is making a different choice, and folding the two together would
 * force them to turn off the notification to silence it.
 */
function loadMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
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
  const [alertsMuted, setAlertsMuted] = useState(loadMuted);
  const alertsMutedRef = useRef(alertsMuted);
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const preferencesRef = useRef(preferences);
  const notificationsCountRef = useRef(persistentNotifications.length);
  const [hasMoreNotifications, setHasMoreNotifications] = useState(true);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    alertsMutedRef.current = alertsMuted;
  }, [alertsMuted]);

  const toggleAlertsMuted = useCallback(() => {
    setAlertsMuted((current) => {
      const next = !current;
      saveMuted(next);
      return next;
    });
  }, []);

  useEffect(() => {
    notificationsCountRef.current = persistentNotifications.length;
  }, [persistentNotifications.length]);

  const unreadCount = persistentNotifications.filter((n) => !n.read).length;

  const refreshNotifications = useCallback(
    async (options?: { offset?: number; limit?: number; append?: boolean }) => {
      const append = options?.append ?? false;
      const offset = options?.offset ?? 0;
      const limit =
        options?.limit ?? Math.max(NOTIFICATIONS_PAGE_SIZE, notificationsCountRef.current);

      if (!user?.id) {
        setPersistentNotifications(loadLocalNotifications());
        setHasMoreNotifications(false);
        return;
      }
      try {
        const data = await api.getNotifications({ offset, limit });
        if (Array.isArray(data)) {
          const mapped: PersistentNotification[] = data.map((n) => ({
            ...n,
            type: (n.type as PersistentNotification["type"]) ?? "info",
          }));
          setHasMoreNotifications(mapped.length >= limit);
          setPersistentNotifications((prev) => {
            const next = append
              ? [...prev, ...mapped.filter((n) => !prev.some((p) => p.id === n.id))]
              : mapped;
            saveLocalNotifications(next);
            return next;
          });
        }
      } catch {
        if (!append) setPersistentNotifications(loadLocalNotifications());
      }
    },
    [user?.id]
  );

  const loadMoreNotifications = useCallback(async () => {
    await refreshNotifications({
      offset: notificationsCountRef.current,
      limit: NOTIFICATIONS_PAGE_SIZE,
      append: true,
    });
  }, [refreshNotifications]);

  useEffect(() => {
    refreshNotifications();
    const interval = setInterval(() => refreshNotifications(), 60_000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  /** Tell sibling tabs about a local change. Never throws. */
  const broadcast = useCallback((message: Record<string, unknown>) => {
    try {
      syncChannelRef.current?.postMessage(message);
    } catch {
      // A closed channel is not a reason to fail the local update.
    }
  }, []);

  const markAsRead = useCallback(
    (id: string) => {
      broadcast({ kind: "read", id });
      setPersistentNotifications((prev) => {
        const updated = prev.map((n) =>
          n.id === id ? { ...n, read: true } : n
        );
        if (user?.id) {
          api.markNotificationRead(id).catch(() => { });
        }
        saveLocalNotifications(updated);
        return updated;
      });
    },
    [broadcast, user?.id]
  );

  const markAllAsRead = useCallback(() => {
    broadcast({ kind: "read_all" });
    setPersistentNotifications((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      if (user?.id) {
        api.markAllNotificationsRead().catch(() => { });
      }
      saveLocalNotifications(updated);
      return updated;
    });
  }, [broadcast, user?.id]);

  const removeNotification = useCallback(
    (id: string) => {
      broadcast({ kind: "removed", id });
      setPersistentNotifications((prev) => {
        const updated = prev.filter((n) => n.id !== id);
        if (user?.id) {
          api.deleteNotification(id).catch(() => { });
        }
        saveLocalNotifications(updated);
        return updated;
      });
    },
    [broadcast, user?.id]
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

  const clearToasts = useCallback(() => {
    toastTimeouts.current.forEach((timeout) => clearTimeout(timeout));
    toastTimeouts.current.clear();
    setToasts([]);
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
      toastPosition?: ToastPosition;
      toastAction?: ToastAction;
      showProgress?: boolean;
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
        toastPosition,
        toastAction,
        showProgress,
      } = params;

      if (!preferencesRef.current[type]) return;

      if (showToast) {
        addToast({
          type,
          title,
          message,
          duration: toastDuration,
          position: toastPosition,
          action: toastAction,
          showProgress,
        });
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
            }).catch(() => { });
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

  /**
   * Apply an arrival to local state.
   *
   * Split out from `handleIncomingNotification` so a notification relayed from
   * another tab lands in the badge without re-broadcasting it — which would
   * otherwise bounce between tabs forever — and without a second chime on
   * every open tab.
   */
  const applyIncomingNotification = useCallback(
    (notification: PersistentNotification) => {
      setPersistentNotifications((prev) => {
        // De-duplicated by id: the same notification can arrive from the
        // socket and from a sibling tab's broadcast.
        const next = [
          notification,
          ...prev.filter((existing) => existing.id !== notification.id),
        ];

        if (!user?.id) {
          saveLocalNotifications(next);
        }
        return next;
      });
    },
    [user?.id]
  );

  const handleIncomingNotification = useCallback(
    (notification: PersistentNotification) => {
      if (!preferencesRef.current[notification.type]) return;

      applyIncomingNotification(notification);

      // Other tabs of this origin update their badge from here. Only the tab
      // holding the socket broadcasts, so exactly one copy is sent.
      try {
        syncChannelRef.current?.postMessage({
          kind: "notification",
          notification,
        });
      } catch {
        // A closed channel must not stop the notification being shown.
      }

      // Alerts fire only for notifications that actually arrived here — never
      // for ones replayed from storage on mount, and never when muted.
      if (!alertsMutedRef.current && !notification.read) {
        void alertUser();
      }

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
    [addToast, applyIncomingNotification]
  );

  /**
   * Keep the badge identical across tabs (Issue #886).
   *
   * Read state is broadcast too: marking everything read in one tab and
   * finding the other still showing "7 unread" is the same staleness the
   * issue is about, seen from the other direction.
   */
  useEffect(() => {
    if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      return;
    }

    const channel = new BroadcastChannel(SYNC_CHANNEL);
    syncChannelRef.current = channel;

    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { kind: "notification"; notification: PersistentNotification }
        | { kind: "read"; id: string }
        | { kind: "read_all" }
        | { kind: "removed"; id: string }
        | undefined;

      if (!data) return;

      switch (data.kind) {
        case "notification":
          applyIncomingNotification(data.notification);
          break;
        case "read":
          setPersistentNotifications((prev) =>
            prev.map((n) => (n.id === data.id ? { ...n, read: true } : n))
          );
          break;
        case "read_all":
          setPersistentNotifications((prev) =>
            prev.map((n) => ({ ...n, read: true }))
          );
          break;
        case "removed":
          setPersistentNotifications((prev) =>
            prev.filter((n) => n.id !== data.id)
          );
          break;
      }
    };

    return () => {
      syncChannelRef.current = null;
      channel.close();
    };
  }, [applyIncomingNotification]);

  useEffect(() => {
    if (!user?.id || typeof window === "undefined") return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retry = 0;
    let closed = false;
    let authFailed = false;

    // 1008 = policy violation, 4401/4403 = app-level auth failure codes
    const AUTH_FAILURE_CLOSE_CODES = [1008, 4401, 4403];

    const buildWsUrl = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      // Token is NOT part of the URL — query strings appear in server access
      // logs, browser history, and Referer headers.  Auth is performed via
      // the first JSON message sent after the socket opens.
      return `${protocol}://${window.location.host}/ws/notifications`;
    };

    const scheduleReconnect = () => {
      if (closed || authFailed) return;
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
        if (parsed?.type === "auth_ok" || parsed?.type === "auth_success") {
          return;
        }
        if (
          parsed?.type === "auth_error" ||
          parsed?.type === "auth_failed" ||
          parsed?.type === "unauthorized"
        ) {
          authFailed = true;
          ws?.close();
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

      // Fetch a short-lived (60 s) WS token from the server immediately
      // before opening the socket.  The token is obtained via the httpOnly
      // cookie session — it is never read from localStorage.
      // It is held only in this closure and discarded once sent.
      api
        .getWsToken()
        .then(({ ws_token }) => {
          if (closed) return;

          try {
            ws = new WebSocket(buildWsUrl());
          } catch {
            scheduleReconnect();
            return;
          }

          ws.onopen = () => {
            retry = 0;
            // Send the short-lived token as the first message — this is the
            // only moment it exists in JS memory.
            ws?.send(JSON.stringify({ type: "auth", token: ws_token }));
          };
          ws.onmessage = (event) => handleMessage(event.data);
          ws.onclose = (event) => {
            if (closed) return;
            if (AUTH_FAILURE_CLOSE_CODES.includes(event.code)) {
              authFailed = true;
              return;
            }
            scheduleReconnect();
          };
          ws.onerror = () => {
            ws?.close();
          };
        })
        .catch(() => {
          // Could not obtain a WS token (e.g. session expired) — back off and
          // retry; the auth-failure handler in ApiClient will redirect to
          // login if the session is truly gone.
          if (!closed) scheduleReconnect();
        });
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [handleIncomingNotification, user?.id]);

  const value: NotificationContextType = {
    alertsMuted,
    toggleAlertsMuted,
    persistentNotifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    removeNotification,
    refreshNotifications,
    hasMoreNotifications,
    loadMoreNotifications,
    toasts,
    addToast,
    removeToast,
    clearToasts,
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
