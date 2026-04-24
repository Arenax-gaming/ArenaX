"use client";

import { cn } from "@/lib/utils";
import type { UserStatus } from "@/types/social";

const statusConfig: Record<UserStatus, { label: string; color: string; bgColor: string }> = {
  online: { label: "Online", color: "bg-green-500", bgColor: "bg-green-500/20" },
  "in-game": { label: "In Game", color: "bg-yellow-500", bgColor: "bg-yellow-500/20" },
  away: { label: "Away", color: "bg-orange-500", bgColor: "bg-orange-500/20" },
  busy: { label: "Busy", color: "bg-red-500", bgColor: "bg-red-500/20" },
  offline: { label: "Offline", color: "bg-gray-500", bgColor: "bg-gray-500/20" },
};

const statusSizeClasses = {
  sm: "h-2 w-2",
  md: "h-3 w-3",
  lg: "h-4 w-4",
};

const avatarSizeClasses = {
  sm: "h-8 w-8 text-sm",
  md: "h-10 w-10 text-base",
  lg: "h-14 w-14 text-xl",
};

interface OnlineStatusProps {
  status: UserStatus;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
}

export function OnlineStatus({
  status,
  size = "md",
  showLabel = false,
  className,
}: OnlineStatusProps) {
  const config = statusConfig[status];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "rounded-full",
          statusSizeClasses[size],
          config.color,
          status === "online" && "animate-pulse",
          "shadow-sm"
        )}
      />
      {showLabel && (
        <span className="text-xs font-medium">{config.label}</span>
      )}
    </div>
  );
}

// Status selector component for changing user status
interface StatusSelectorProps {
  currentStatus: UserStatus;
  onStatusChange: (status: UserStatus) => void;
  className?: string;
}

export function StatusSelector({ currentStatus, onStatusChange, className }: StatusSelectorProps) {
  const statuses: UserStatus[] = ["online", "in-game", "away", "busy", "offline"];

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {statuses.map((status) => {
        const config = statusConfig[status];
        const isActive = currentStatus === status;

        return (
          <button
            key={status}
            onClick={() => onStatusChange(status)}
            className={cn(
              "relative rounded-full p-1 transition-all",
              isActive
                ? cn(config.bgColor, "ring-2", config.color.replace("bg-", "ring-"))
                : "hover:bg-muted",
              "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            )}
            title={config.label}
          >
            <span
              className={cn(
                "block rounded-full",
                statusSizeClasses.sm,
                config.color
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

// Avatar with status indicator
interface AvatarWithStatusProps {
  avatar?: string;
  username: string;
  status: UserStatus;
  size?: "sm" | "md" | "lg";
  showStatus?: boolean;
  className?: string;
  onClick?: () => void;
}

export function AvatarWithStatus({
  avatar,
  username,
  status,
  size = "md",
  showStatus = true,
  className,
  onClick,
}: AvatarWithStatusProps) {
  const statusDotSize = size === "sm" ? "sm" : "sm";

  return (
    <div
      className={cn("relative inline-block", className)}
      onClick={onClick}
    >
      <div
        className={cn(
          "rounded-full overflow-hidden bg-muted flex items-center justify-center shrink-0",
          avatarSizeClasses[size],
          onClick && "cursor-pointer hover:opacity-80 transition-opacity"
        )}
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt={username}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="font-bold">{username.charAt(0).toUpperCase()}</span>
        )}
      </div>
      {showStatus && (
        <span
          className={cn(
            "absolute bottom-0 right-0 rounded-full border-2 border-card",
            statusSizeClasses[statusDotSize],
            statusConfig[status].color
          )}
        />
      )}
    </div>
  );
}