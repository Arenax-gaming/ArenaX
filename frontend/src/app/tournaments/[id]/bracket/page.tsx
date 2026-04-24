"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { mockTournaments } from "@/data/mockTournaments";
import { generateMockBracket } from "@/data/mockBracket";
import { TournamentBracket } from "@/components/tournaments/TournamentBracket";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, Trophy } from "lucide-react";

export default function TournamentBracketPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const tournamentId = params.id as string;
  const currentUserId = user?.id ?? "user-123";

  const tournament = useMemo(
    () => mockTournaments.find((t) => t.id === tournamentId),
    [tournamentId],
  );

  const bracketData = useMemo(() => {
    if (!tournament) return null;
    if (tournament.status !== "in_progress" && tournament.status !== "completed") return null;
    return generateMockBracket(tournament, currentUserId);
  }, [tournament, currentUserId]);

  if (!tournament) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="mb-2 text-2xl font-bold text-foreground">Tournament Not Found</h1>
          <Button onClick={() => router.push("/tournaments")}>Back to Tournaments</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-6xl">
        {/* Nav */}
        <div className="mb-6 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <span className="text-muted-foreground">/</span>
          <Link href={`/tournaments/${tournament.id}`} className="text-sm text-muted-foreground hover:text-foreground">
            {tournament.name}
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium text-foreground">Bracket</span>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">{tournament.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {tournament.tournamentType.replace(/_/g, " ")} · {tournament.gameType}
          </p>
        </div>

        {/* Bracket or unavailable */}
        {bracketData ? (
          <TournamentBracket bracketData={bracketData} currentUserId={currentUserId} />
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-16 text-center">
            <Trophy className="mb-4 h-16 w-16 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold text-foreground">Bracket Not Available</h3>
            <p className="mb-6 text-sm text-muted-foreground">
              The bracket will be available once the tournament is in progress.
            </p>
            <Link href={`/tournaments/${tournament.id}`}>
              <Button variant="outline">View Tournament Details</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
