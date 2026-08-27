"use client";

import React, { useState } from "react";
import {
  Users,
  MessageSquare,
  Send,
  Check,
  UserPlus,
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
      setActiveChannel(
        `tournament-${tournamentId}`,
        CollaborationChannelType.TOURNAMENT_COVIEW
      );
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

  const peers = channel?.users ?? [];
  const hasPeers = peers.length > 0;
  const messageEvents = events.filter(
    (e) => e.type === CollaborationEventType.MESSAGE
  );

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
        {/* Not joined yet */}
        {!isInCoView && (
          <div className="text-center py-6 text-muted-foreground">
            Join the viewing party to chat and see who else is watching!
          </div>
        )}

        {/* Joined but no real peers connected yet */}
        {isInCoView && !isConnected && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
              <UserPlus className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Invite friends to watch together</p>
              <p className="text-xs text-muted-foreground">
                Nobody else has joined yet. Share this tournament link to watch
                with friends.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <div className="h-2 w-2 rounded-full bg-muted-foreground" />
              Connecting…
            </div>
          </div>
        )}

        {/* Joined and connected, but channel is empty (no peers) */}
        {isInCoView && isConnected && !hasPeers && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/40">
              <UserPlus className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Invite friends to watch together</p>
              <p className="text-xs text-muted-foreground">
                You&apos;re the only one here right now. Share this tournament link so
                friends can join your viewing party.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
              <div className="h-2 w-2 rounded-full bg-success" />
              Connected — waiting for others
            </div>
          </div>
        )}

        {/* Joined, connected and at least one peer is present */}
        {isInCoView && isConnected && hasPeers && (
          <div className="space-y-4">
            {/* Connected users */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                {peers.length} watching
              </h4>
              <div className="flex flex-wrap gap-2">
                {peers.map((user) => (
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
                <span className="text-sm font-medium text-muted-foreground">
                  Chat
                </span>
              </div>
              <div className="bg-muted/20 rounded-lg p-3 max-h-48 overflow-y-auto space-y-2">
                {messageEvents.map((event) => {
                  const msgEvent = event as any;
                  const user = peers.find((u) => u.id === msgEvent.userId);
                  return (
                    <div
                      key={msgEvent.messageId}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span className="font-medium text-primary">
                        {user?.username ?? "Unknown"}:
                      </span>
                      <span className="text-foreground">{msgEvent.content}</span>
                    </div>
                  );
                })}
                {messageEvents.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center">
                    No messages yet
                  </p>
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
                  placeholder="Type a message…"
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
              <div className="h-2 w-2 rounded-full bg-success" />
              Connected
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
