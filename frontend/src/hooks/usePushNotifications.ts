// filepath: frontend/src/hooks/usePushNotifications.ts
"use client";

import { useState, useEffect, useCallback } from "react";

interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
}

interface PushNotificationPermission {
  status: NotificationPermission;
  token?: string;
}

interface UsePushNotificationsReturn {
  permission: NotificationPermission;
  token: string | null;
  isSupported: boolean;
  isEnabled: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  showNotification: (payload: PushNotificationPayload) => void;
}

// Check if push notifications are supported
const isPushSupported = (): boolean => {
  if (typeof window === "undefined") return false;
  
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    Notification.permission !== "denied"
  );
};

// Get current permission status
const getPermissionStatus = async (): Promise<NotificationPermission> => {
  if (typeof window === "undefined") return "default";
  
  // Check if already granted
  if (Notification.permission === "granted") {
    return "granted";
  }
  
  // Check if denied
  if (Notification.permission === "denied") {
    return "denied";
  }
  
  return "default";
};

export function usePushNotifications(): UsePushNotificationsReturn {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [token, setToken] = useState<string | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);

  // Check support and permission on mount
  useEffect(() => {
    const checkPermission = async () => {
      if (!isPushSupported()) {
        console.log("[PushNotifications] Not supported");
        return;
      }

      const status = await getPermissionStatus();
      setPermission(status);

      if (status === "granted") {
        setIsEnabled(true);
        // Get token if available
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            setToken(subscription.endpoint);
          }
        } catch (error) {
          console.error("[PushNotifications] Error getting subscription:", error);
        }
      }
    };

    checkPermission();
  }, []);

  // Subscribe to push notifications
  const subscribe = useCallback(async () => {
    if (!isPushSupported()) {
      console.error("[PushNotifications] Push not supported");
      throw new Error("Push notifications not supported");
    }

    try {
      // Request permission
      const permissionResult = await Notification.requestPermission();
      setPermission(permissionResult);

      if (permissionResult !== "granted") {
        throw new Error("Permission not granted");
      }

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          // In production, use your VAPID public key
          process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ""
        ),
      });

      // Send subscription to server
      const subscriptionJson = subscription.toJSON();
      
      // In production, send to your backend
      // await fetch('/api/notifications/subscribe', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(subscriptionJson),
      // });

      setToken(subscription.endpoint);
      setIsEnabled(true);

      console.log("[PushNotifications] Subscribed successfully");
    } catch (error) {
      console.error("[PushNotifications] Subscription error:", error);
      throw error;
    }
  }, []);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();
        
        // In production, notify backend
        // await fetch('/api/notifications/unsubscribe', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ endpoint: subscription.endpoint }),
        // });
      }

      setToken(null);
      setIsEnabled(false);

      console.log("[PushNotifications] Unsubscribed successfully");
    } catch (error) {
      console.error("[PushNotifications] Unsubscribe error:", error);
      throw error;
    }
  }, []);

  // Show local notification (for testing)
  const showNotification = useCallback(
    (payload: PushNotificationPayload) => {
      if (permission !== "granted") {
        console.warn("[PushNotifications] Permission not granted");
        return;
      }

      const options: NotificationOptions = {
        body: payload.body,
        icon: payload.icon || "/icons/icon-192x192.png",
        badge: payload.badge || "/icons/icon-72x72.png",
        tag: payload.tag,
        data: payload.data,
        vibrate: [100, 50, 100],
        actions: payload.actions,
      };

      // Try to use service worker notification first
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.showNotification(payload.title, options);
        });
      } else {
        // Fallback to standard notification
        new Notification(payload.title, options);
      }
    },
    [permission]
  );

  return {
    permission,
    token,
    isSupported: isPushSupported(),
    isEnabled,
    subscribe,
    unsubscribe,
    showNotification,
  };
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  if (!base64String) return new Uint8Array();
  
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export default usePushNotifications;