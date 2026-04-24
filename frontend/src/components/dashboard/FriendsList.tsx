"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { UserPlus } from "lucide-react";

interface Friend {
  id: string;
  username: string;
  avatar?: string;
  elo: number;
  status: "online" | "in-game" | "offline";
}

const mockFriends: Friend[] = [
  { id: "f1", username: "ShadowNinja", elo: 1380, status: "online" },
  { id: "f2", username: "EliteSniper", elo: 1420, status: "in-game" },
  { id: "f3", username: "DragonSlayer", elo: 1190, status: "online" },
  { id: "f4", username: "NightWalker", elo: 1510, status: "offline" },
  { id: "f5", username: "SpeedRunner", elo: 1100, status: "offline" },
];

const statusConfig = {
  online: { label: "Online", color: "bg-green-500" },
  "in-game": { label: "In Game", color: "bg-yellow-500" },
  offline: { label: "Offline", color: "bg-muted-foreground" },
};

interface FriendsListProps {
  compact?: boolean;
}

export function FriendsList({ compact = false }: FriendsListProps) {
  const sorted = [...mockFriends].sort((a, b) => {
    const order = { online: 0, "in-game": 1, offline: 2 };
    return order[a.status] - order[b.status];
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">
            Friends <span className="text-muted-foreground font-normal text-sm">({mockFriends.filter(f => f.status !== "offline").length} online)</span>
          </CardTitle>
          <Button variant="ghost" size="sm" className="h-7 px-2">
            <UserPlus className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {sorted.slice(0, compact ? 4 : sorted.length).map((friend) => {
            const cfg = statusConfig[friend.status];
            return (
              <div key={friend.id} className="flex items-center gap-3 px-6 py-2.5 hover:bg-muted/40 transition-colors">
                <div className="relative shrink-0">
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                    {friend.username.charAt(0)}
                  </div>
                  <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card ${cfg.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{friend.username}</p>
                  <p className="text-xs text-muted-foreground">{cfg.label}</p>
                </div>
                <span className="text-xs font-mono text-muted-foreground">{friend.elo}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
