"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Gamepad2, Swords, Trophy, Zap } from "lucide-react";
import type { MatchWithPlayers } from "@/types/match";

/** How often (ms) to re-fetch active matches in the background. */
const POLL_INTERVAL_MS = 30_000;

// ─── Game mode shortcuts ──────────────────────────────────────────────────────

const gameModes = [
  {
    label: "Quick Match",
    description: "Jump into a ranked 1v1",
    href: "/tournaments",
    icon: <Zap className="h-6 w-6" aria-hidden="true" />,
    color:
      "bg-primary/10 hover:bg-primary/20 border-primary/20 text-primary",
  },
  {
    label: "Tournament",
    description: "Browse open tournaments",
    href: "/tournaments",
    icon: <Trophy className="h-6 w-6" aria-hidden="true" />,
    color:
      "bg-yellow-500/10 hover:bg-yellow-500/20 border-yellow-500/20 text-yellow-600 dark:text-yellow-400",
  },
  {
    label: "Practice",
    description: "Unranked casual match",
    href: "/tournaments",
    icon: <Gamepad2 className="h-6 w-6" aria-hidden="true" />,
    color:
      "bg-success/10 hover:bg-success/20 border-green-500/20 text-green-600 dark:text-green-400",
  },
];

// ─── Active match card ────────────────────────────────────────────────────────

function ActiveMatchCard({ match }: { match: MatchWithPlayers }) {
  const opponentUsername =
    match.player2Username ?? match.player2Id.slice(0, 8) + "…";
  const gameLabel = match.gameType ?? "Match";

  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg border-2 border-primary/30 bg-primary/5 animate-pulse-slow">
      <div className="flex items-center gap-3 min-w-0">
        <Swords
          className="h-5 w-5 text-primary shrink-0"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">
            {gameLabel} — vs {opponentUsername}
          </p>
          <p className="text-xs text-muted-foreground">In progress</p>
        </div>
      </div>
      <Link href={`/matches/${match.id}`} className="shrink-0">
        <Button size="sm" variant="primary" className="h-8">
          Resume
        </Button>
      </Link>
    </div>
  );
}

// ─── QuickPlay component ──────────────────────────────────────────────────────

export function QuickPlay() {
  const { data: activeMatches = [] } = useQuery<MatchWithPlayers[]>({
    queryKey: ["activeMatches"],
    queryFn: () => api.getActiveMatches(),
    // Re-fetch on a 30-second interval
    refetchInterval: POLL_INTERVAL_MS,
    // Re-fetch immediately when the user switches back to this tab
    refetchOnWindowFocus: true,
    // Keep showing stale data while the background refresh is in flight
    staleTime: POLL_INTERVAL_MS,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Quick Play</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Active matches — shown above the shortcuts when present */}
        {activeMatches.length > 0 && (
          <section aria-label="Active matches" className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Active
            </p>
            {activeMatches.map((match) => (
              <ActiveMatchCard key={match.id} match={match} />
            ))}
          </section>
        )}

        {/* Game mode shortcuts */}
        <section
          aria-label="Start a game"
          className={activeMatches.length > 0 ? "pt-1 space-y-2" : "space-y-2"}
        >
          {activeMatches.length > 0 && (
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Start new
            </p>
          )}
          {gameModes.map((mode) => (
            <Link key={mode.label} href={mode.href}>
              <div
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${mode.color}`}
              >
                {mode.icon}
                <div>
                  <p className="text-sm font-semibold">{mode.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {mode.description}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </section>
      </CardContent>
    </Card>
  );
}
