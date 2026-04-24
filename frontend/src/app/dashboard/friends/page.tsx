"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Search, UserPlus, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Friend {
  id: string;
  username: string;
  elo: number;
  status: "online" | "in-game" | "offline";
  gamesPlayed: number;
}

const mockFriends: Friend[] = [
  { id: "f1", username: "ShadowNinja", elo: 1380, status: "online", gamesPlayed: 12 },
  { id: "f2", username: "EliteSniper", elo: 1420, status: "in-game", gamesPlayed: 8 },
  { id: "f3", username: "DragonSlayer", elo: 1190, status: "online", gamesPlayed: 5 },
  { id: "f4", username: "NightWalker", elo: 1510, status: "offline", gamesPlayed: 20 },
  { id: "f5", username: "SpeedRunner", elo: 1100, status: "offline", gamesPlayed: 3 },
];

const statusConfig = {
  online: { label: "Online", dot: "bg-green-500" },
  "in-game": { label: "In Game", dot: "bg-yellow-500" },
  offline: { label: "Offline", dot: "bg-muted-foreground/50" },
};

type Tab = "all" | "online" | "offline";

export default function FriendsPage() {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [addInput, setAddInput] = useState("");

  const filtered = mockFriends.filter((f) => {
    const matchesSearch = f.username.toLowerCase().includes(search.toLowerCase());
    const matchesTab =
      tab === "all" ||
      (tab === "online" && f.status !== "offline") ||
      (tab === "offline" && f.status === "offline");
    return matchesSearch && matchesTab;
  });

  const sorted = [...filtered].sort((a, b) => {
    const order = { online: 0, "in-game": 1, offline: 2 };
    return order[a.status] - order[b.status];
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: `All (${mockFriends.length})` },
    { key: "online", label: `Online (${mockFriends.filter((f) => f.status !== "offline").length})` },
    { key: "offline", label: "Offline" },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <h1 className="text-2xl font-black tracking-tight">Friends</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Friends list */}
        <div className="lg:col-span-2 space-y-4">
          {/* Search + tabs */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search friends..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-1 bg-muted rounded-md p-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "px-3 py-1 text-xs font-medium rounded transition-colors",
                    tab === t.key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {sorted.map((friend) => {
                  const cfg = statusConfig[friend.status];
                  return (
                    <div key={friend.id} className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors">
                      <div className="relative shrink-0">
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center font-bold">
                          {friend.username.charAt(0)}
                        </div>
                        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${cfg.dot}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{friend.username}</p>
                        <p className="text-xs text-muted-foreground">{cfg.label} · {friend.gamesPlayed} games together</p>
                      </div>
                      <span className="text-sm font-mono text-muted-foreground hidden sm:block">{friend.elo} ELO</span>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Message">
                          <MessageCircle className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 text-xs">
                          Challenge
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {sorted.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-10">No friends found</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Add friend panel */}
        <div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Add Friend</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Enter username..."
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
              />
              <Button className="w-full" disabled={!addInput.trim()}>
                <UserPlus className="h-4 w-4 mr-2" />
                Send Request
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Search by exact username to send a friend request.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
