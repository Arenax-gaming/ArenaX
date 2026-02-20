"use client";

import { useRef, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, Trash2, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/contexts/NotificationContext";
import { Button } from "@/components/ui/Button";
import { PersistentNotification } from "@/types/notification";

function formatTime(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return date.toLocaleDateString();
}

function NotificationItem({
  notification,
  onClose,
}: {
  notification: PersistentNotification;
  onClose?: () => void;
}) {
  const { markAsRead, removeNotification } = useNotifications();
  const isRead = notification.read;

  const handleClick = () => {
    if (!isRead) markAsRead(notification.id);
    onClose?.();
  };

  const content = (
    <div
      className={cn(
        "flex flex-col gap-1 p-3 rounded-lg transition-colors cursor-pointer",
        !isRead && "bg-primary/5"
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleClick();
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn("font-medium text-sm", !isRead && "font-semibold")}>
          {notification.title}
        </p>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatTime(notification.createdAt)}
        </span>
      </div>
      {notification.message && (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {notification.message}
        </p>
      )}
      {notification.link && (
        <span className="text-xs text-primary font-medium">
          {notification.linkLabel ?? "View"}
        </span>
      )}
    </div>
  );

  return (
    <li className="group relative border-b border-border/50 last:border-0">
      {notification.link ? (
        <Link href={notification.link} onClick={onClose}>
          {content}
        </Link>
      ) : (
        content
      )}
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          removeNotification(notification.id);
        }}
        aria-label="Remove notification"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

interface NotificationBellProps {
  className?: string;
  onClose?: () => void;
}

export function NotificationBell({ className, onClose }: NotificationBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const {
    persistentNotifications,
    unreadCount,
    markAllAsRead,
    refreshNotifications,
  } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshNotifications();
    setRefreshing(false);
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <Button
        variant="ghost"
        size="sm"
        className="relative h-9 w-9 p-0"
        onClick={() => setIsOpen((o) => !o)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-lg border bg-popover text-popover-foreground shadow-lg z-50 animate-in fade-in-0 zoom-in-95"
          role="menu"
        >
          <div className="flex items-center justify-between border-b p-3">
            <h3 className="font-semibold">Notifications</h3>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={handleRefresh}
                disabled={refreshing}
                aria-label="Refresh notifications"
              >
                {refreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs"
                  onClick={markAllAsRead}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </Button>
              )}
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {persistentNotifications.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              <ul className="divide-y divide-border/50">
                {persistentNotifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onClose={() => {
                      setIsOpen(false);
                      onClose?.();
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
