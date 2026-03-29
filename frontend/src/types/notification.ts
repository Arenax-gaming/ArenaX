// Notification types for Global Notification Center

export type NotificationType = "info" | "success" | "warning" | "error" | "match";

export type NotificationPreferences = Record<NotificationType, boolean>;

export interface PersistentNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  linkLabel?: string;
  read: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ToastNotification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  createdAt: number;
}
