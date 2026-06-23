"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trophy, Users, Clock, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { mockTournaments } from "@/data/mockTournaments";
import type { Tournament } from "@/types/tournament";

export function ActiveTournamentsSection() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);

  useEffect(() => {
    // Show a few active / registration-open tournaments on the landing page.
    const active = mockTournaments
      .filter(
        (t) =>
          t.status === "registration_open" || t.status === "in_progress",
      )
      .slice(0, 3);
    setTournaments(active);
  }, []);

  if (tournaments.length === 0) return null;

  return (
    <section className="space-y-6">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="h-6 w-6 text-yellow-500" aria-hidden="true" />
            Active Tournaments
          </h2>
          <p className="text-muted-foreground text-sm">
            Jump in — registration is open now.
          </p>
        </div>
        <Link href="/tournaments">
          <Button variant="ghost" size="sm" className="gap-1">
            View all
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Tournament cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {tournaments.map((t) => (
          <Card key={t.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base font-semibold leading-tight line-clamp-2">
                  {t.name}
                </CardTitle>
                <Badge
                  variant="outline"
                  className={
                    t.status === "in_progress"
                      ? "border-green-500 text-green-600 shrink-0"
                      : "border-blue-500 text-blue-600 shrink-0"
                  }
                >
                  {t.status === "in_progress" ? "Live" : "Open"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Stats row */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.currentParticipants}/{t.maxParticipants}
                </span>
                <span className="flex items-center gap-1">
                  <Trophy className="h-3.5 w-3.5 text-yellow-500" aria-hidden="true" />
                  ${t.prizePool.toLocaleString()}
                </span>
                {t.entryFee === 0 ? (
                  <span className="text-green-600 font-medium">Free</span>
                ) : (
                  <span>${t.entryFee} entry</span>
                )}
              </div>

              <Link href={`/tournaments/${t.id}`} className="block">
                <Button size="sm" className="w-full">
                  {t.status === "in_progress" ? "Watch" : "Join"}
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
