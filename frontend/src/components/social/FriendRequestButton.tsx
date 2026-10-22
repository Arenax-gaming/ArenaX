"use client";

import { Check, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  useFriendRequest,
  type FriendRequestStatus,
} from "@/hooks/useFriendRequests";

interface FriendRequestButtonProps {
  userId: string;
  username?: string;
  /** Status known from the server when the button first renders. */
  initialStatus?: FriendRequestStatus;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Send / withdraw a friend request with optimistic UI (Issue #1323).
 *
 * The label switches to "Requested" the moment it's clicked; if the server
 * rejects the request, the hook rolls the state back and shows an error
 * toast. Rapid repeat clicks are ignored while a request is in flight.
 */
export function FriendRequestButton({
  userId,
  username,
  initialStatus = "none",
  size = "sm",
  className,
}: FriendRequestButtonProps) {
  const { isRequested, isPending, toggle } = useFriendRequest(userId, {
    initialStatus,
    username,
  });

  const who = username ?? "this player";
  const ariaLabel = isRequested
    ? `Friend request sent to ${who}. Activate to cancel it.`
    : `Send friend request to ${who}`;

  return (
    <Button
      type="button"
      size={size}
      variant={isRequested ? "outline" : "default"}
      onClick={() => toggle()}
      aria-label={ariaLabel}
      aria-pressed={isRequested}
      aria-busy={isPending}
      data-state={isRequested ? "requested" : "idle"}
      className={cn("gap-1.5", className)}
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : isRequested ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <UserPlus className="h-4 w-4" aria-hidden="true" />
      )}
      {isRequested ? "Requested" : "Add Friend"}
    </Button>
  );
}

export default FriendRequestButton;
