 "use client";

import { Check, X, Clock, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AvatarWithStatus } from "./OnlineStatus";
import type { FriendRequest } from "@/types/social";

interface FriendRequestsProps {
  requests: FriendRequest[];
  onAccept: (requestId: string) => void;
  onDecline: (requestId: string) => void;
}

export function FriendRequests({ requests, onAccept, onDecline }: FriendRequestsProps) {
  const pendingRequests = requests.filter(r => r.status === "pending");

  if (pendingRequests.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Friend Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
              <Check className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No pending friend requests</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Friend Requests
            <span className="ml-2 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-full">
              {pendingRequests.length}
            </span>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {pendingRequests.map((request) => (
            <div
              key={request.id}
              className="flex items-start gap-3 p-4 hover:bg-muted/40 transition-colors"
            >
              <AvatarWithStatus
                avatar={request.fromUser.avatar}
                username={request.fromUser.username}
                status={request.fromUser.status}
                size="md"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{request.fromUser.username}</span>
                  <span className="text-xs font-mono text-muted-foreground">
                    ELO {request.fromUser.elo}
                  </span>
                </div>
                {request.message && (
                  <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                    {request.message}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(request.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    variant="primary"
                    size="sm"
                    className="h-8"
                    onClick={() => onAccept(request.id)}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Accept
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => onDecline(request.id)}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Decline
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// Extended component for managing all friend request states
interface FriendRequestManagerProps extends FriendRequestsProps {
  allRequests?: FriendRequest[];
}

export function FriendRequestManager({
  requests,
  allRequests,
  onAccept,
  onDecline,
}: FriendRequestManagerProps) {
  const pendingRequests = requests.filter(r => r.status === "pending");
  const processedRequests = allRequests?.filter(r => r.status !== "pending") || [];

  return (
    <div className="space-y-6">
      <FriendRequests
        requests={requests}
        onAccept={onAccept}
        onDecline={onDecline}
      />

      {processedRequests.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {processedRequests.slice(0, 5).map((request) => (
                <div
                  key={request.id}
                  className="flex items-center gap-3 p-3 text-sm"
                >
                  <AvatarWithStatus
                    avatar={request.fromUser.avatar}
                    username={request.fromUser.username}
                    status={request.fromUser.status}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{request.fromUser.username}</span>
                    <span className="text-muted-foreground"> — </span>
                    <span
                      className={
                        request.status === "accepted"
                          ? "text-green-600"
                          : "text-red-600"
                      }
                    >
                      {request.status === "accepted" ? "Accepted" : "Declined"}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(request.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Friend request notification badge
interface FriendRequestBadgeProps {
  count: number;
  onClick?: () => void;
}

export function FriendRequestBadge({ count, onClick }: FriendRequestBadgeProps) {
  if (count === 0) return null;

  return (
    <button
      onClick={onClick}
      className="relative inline-flex items-center justify-center"
    >
      <AlertCircle className="h-5 w-5 text-muted-foreground" />
      <span className="absolute -top-1 -right-1 h-4 min-w-[16px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
        {count}
      </span>
    </button>
  );
}