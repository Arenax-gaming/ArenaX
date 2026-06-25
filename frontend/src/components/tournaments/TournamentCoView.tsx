"use client";

import React, { useState } from "react";
import {
  Users,
  MessageSquare,
  Send,
  Check,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AvatarWithStatus } from "@/components/social/OnlineStatus";
import { useCollaboration } from "@/components/providers/CollaborationProvider";
import { CollaborationEventType, CollaborationChannelType } from "@/types/collaboration";
import type { UserStatus } from "@/types/social";
import { cn } from "@/lib/utils";

interface TournamentCoViewProps {
  tournamentId: string;
  className?: string;
}

export function TournamentCoView({
  tournamentId,
  className,
}: TournamentCoViewProps) {
  const {
    activeChannelId,
    setActiveChannel,
    isConnected,
    channel,
    events,
    sendEvent,
  } = useCollaboration();
  const [messageInput, setMessageInput] = useState("");

  const isInCoView = activeChannelId === `tournament-${tournamentId}`;

  const toggleCoView = () => {
    if (isInCoView) {
      setActiveChannel(null, null);
    } else {
      setActiveChannel(`tournament-${tournamentId}`, CollaborationChannelType.TOURNAMENT_COVIEW);
    }
  };

  const handleSendMessage = () => {
    if (!messageInput.trim()) return;
    sendEvent({
      type: CollaborationEventType.MESSAGE,
      channelId: `tournament-${tournamentId}`,
      content: messageInput.trim(),
      messageId: `msg-${Date.now()}`,
    } as any);
    setMessageInput("");
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Users className="h-5 w-5" />
            Viewing Party
          </CardTitle>
          <Button
            variant={isInCoView ? "outline" : "primary"}
            size="sm"
            onClick={toggleCoView}
          >
            {isInCoView ? "Leave" : "Join"}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {!isInCoView ? (
          <div className="text-center py-6 text-muted-foreground">
            Join the viewing party to chat and see who else is watching!
          </div>
        ) : (
          <div className="space-y-4">
            {/* Connected users */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                {channel?.users.length || 0} watching
              </h4>
              <div className="flex flex-wrap gap-2">
                {channel?.users.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-2 bg-muted/30 px-3 py-1.5 rounded-full"
                  >
                    <AvatarWithStatus
                      avatar={user.avatar}
                      username={user.username}
                      status={user.status as UserStatus}
                      size="sm"
                    />
                    <span className="text-sm">{user.username}</span>
                    {user.isReady && <Check className="h-3 w-3 text-success" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Chat */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Chat</span>
              </div>
              <div className="bg-muted/20 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                {events
                  .filter((e) => e.type === CollaborationEventType.MESSAGE)
                  .map((event) => {
                    const msgEvent = event as any;
                    const user = channel?.users.find((u) => u.id === msgEvent.userId);
                    return (
                      <div
                        key={msgEvent.messageId}
                        className="flex items-start gap-2 text-sm"
                      >
                        <span className="font-medium text-primary">
                          {user?.username || "Unknown"}:
                        </span>
                        <span className="text-foreground">{msgEvent.content}</span>
                      </div>
                    );
                  })}
                {events.filter((e) => e.type === CollaborationEventType.MESSAGE).length === 0 && (
                  <p className="text-sm text-muted-foreground text-center">No messages yet</p>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendMessage();
                  }}
                  placeholder="Type a message..."
                  className="flex-1 px-3 py-2 bg-muted rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSendMessage}
                  disabled={!messageInput.trim()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Connection status */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  isConnected ? "bg-success" : "bg-muted-foreground"
                )}
              />
              {isConnected ? "Connected" : "Disconnected"}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
