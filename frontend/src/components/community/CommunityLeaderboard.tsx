"use client";

import { useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import {
  boardFromSocket,
  communityChannel,
  fetchBoard,
  leaderboardWsUrl,
  mergeBoard,
  type CommunityBoard,
} from "@/lib/communityLeaderboard";

export function CommunityLeaderboard() {
  const [community, setCommunity] = useState("arenax");
  const [tournament, setTournament] = useState("");
  const [board, setBoard] = useState<CommunityBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const expectedCommunity = community.trim().toLowerCase();
    const expectedTournament = tournament.trim().toLowerCase() || null;
    if (!expectedCommunity) return;

    let cancelled = false;
    const apply = (incoming: CommunityBoard | null) => {
      if (!incoming || cancelled) return;
      setBoard((current) => mergeBoard(current, incoming, expectedCommunity, expectedTournament));
      setError(null);
    };

    const load = async () => {
      try {
        apply(await fetchBoard(expectedCommunity, tournament));
      } catch {
        if (!cancelled) setError("Couldn't load the community leaderboard.");
      }
    };

    setBoard(null);
    void load();
    const timer = window.setInterval(() => void load(), 3000);

    let socket: WebSocket | null = null;
    const url = leaderboardWsUrl();
    if (url) {
      try {
        socket = new WebSocket(url);
        socket.onopen = () => {
          setLive(true);
          socket?.send(JSON.stringify({ type: "subscribe", channel: communityChannel(expectedCommunity) }));
        };
        socket.onmessage = (message) => {
          apply(boardFromSocket(String(message.data), expectedCommunity, expectedTournament));
        };
        socket.onclose = () => setLive(false);
        socket.onerror = () => setLive(false);
      } catch {
        setLive(false);
      }
    }

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      socket?.close();
    };
  }, [community, tournament]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Trophy className="h-4 w-4" />
          Community leaderboard
          <span className="text-xs font-normal text-muted-foreground">
            {live ? "Live" : "Refreshing"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground space-y-1">
            <span>Community</span>
            <Input
              value={community}
              onChange={(event) => setCommunity(event.target.value)}
              aria-label="Community"
            />
          </label>
          <label className="text-xs text-muted-foreground space-y-1">
            <span>Tournament</span>
            <Input
              value={tournament}
              onChange={(event) => setTournament(event.target.value)}
              placeholder="All tournaments"
              aria-label="Tournament"
            />
          </label>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="overflow-x-auto" aria-live="polite">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Rank</th>
                <th className="py-2 pr-3 font-medium">Player</th>
                <th className="py-2 font-medium text-right">Reputation</th>
              </tr>
            </thead>
            <tbody>
              {board && board.entries.length > 0 ? (
                board.entries.map((entry) => (
                  <tr key={entry.user_id} className="border-t">
                    <td className="py-2 pr-3 font-semibold">{entry.rank}</td>
                    <td className="py-2 pr-3">{entry.username}</td>
                    <td className="py-2 text-right tabular-nums">{entry.reputation} REP</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-4 text-muted-foreground">
                    No ranked players in this {tournament.trim() ? "tournament" : "community"} yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
