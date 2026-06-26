"use client";

import React from "react";
import { Bell, CheckCheck, Trash2, Settings, BellOff } from "lucide-react";
import Link from "next/link";
import { useNotifications } from "@/contexts/NotificationContext";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/Button";
import { PersistentNotification } from "@/types/notification";
import { cn } from "@/lib/utils";

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
}: {
  notification: PersistentNotification;
}) {
  const { markAsRead, removeNotification } = useNotifications();
  const isRead = notification.read;

  const handleClick = () => {
    if (!isRead) markAsRead(notification.id);
  };

  const content = (
    <div
      className={cn(
        "flex flex-col gap-1 p-4 rounded-lg transition-colors cursor-pointer",
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
        <p className="text-sm text-muted-foreground line-clamp-3">
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
    <div className="group relative border-b border-border/50 last:border-0">
      {notification.link ? (
        <Link href={notification.link} className="block">
          {content}
        </Link>
      ) : (
        content
      )}
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2 h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          removeNotification(notification.id);
        }}
        aria-label="Remove notification"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function NotificationsPage() {
  const {
    persistentNotifications,
    unreadCount,
    markAllAsRead,
  } = useNotifications();

  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
              <Bell className="w-7 h-7" />
              Notifications
            </h1>
            <p className="text-muted-foreground">
              {unreadCount > 0
                ? `You have ${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}`
                : "You're all caught up!"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-2"
                onClick={markAllAsRead}
              >
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </Button>
            )}
            <Link href="/notifications/settings">
              <Button variant="ghost" size="sm" className="gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </Link>
          </div>
        </div>

        {/* Notifications List */}
        <div className="bg-card rounded-lg border shadow-sm">
          {persistentNotifications.length === 0 ? (
            <div className="p-12">
              <EmptyState
                icon={BellOff}
                title="No notifications yet"
                description="You're all caught up! We'll notify you when there's something new."
              />
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {persistentNotifications.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
