"use client";

import React from "react";
import { FriendEntry } from "@/types/profile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Users } from "lucide-react";

interface FriendsListProps {
  friends: FriendEntry[];
  isOwner: boolean;
  onAddFriend?: () => void;
}

const STATUS_ORDER: Record<FriendEntry["status"], number> = {
  online: 0,
  "in-game": 1,
  offline: 2,
};

const STATUS_COLOR: Record<FriendEntry["status"], string> = {
  online: "bg-green-500",
  "in-game": "bg-yellow-400",
  offline: "bg-gray-400",
};

export function FriendsList({ friends, isOwner, onAddFriend }: FriendsListProps) {
  const sorted = [...friends].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Friends
          </span>
          {isOwner && (
            <Button size="sm" variant="outline" onClick={onAddFriend}>
              Add Friend
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-muted-foreground">No friends yet</p>
            <Button variant="outline" size="sm">
              Find Players
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((friend) => (
              <div
                key={friend.id}
                data-testid="friend-item"
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <span
                  data-testid="status-indicator"
                  data-status={friend.status}
                  className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${STATUS_COLOR[friend.status]}`}
                />
                <span className="flex-1 font-medium text-sm">{friend.username}</span>
                <span className="text-xs text-muted-foreground">{friend.elo} ELO</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
