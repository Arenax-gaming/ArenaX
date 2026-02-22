"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { TournamentHeader } from "@/components/tournaments/TournamentHeader";
import { TournamentRules } from "@/components/tournaments/TournamentRules";
import { TournamentParticipants } from "@/components/tournaments/TournamentParticipants";
import { JoinTournamentButton } from "@/components/tournaments/JoinTournamentButton";
import { mockTournaments } from "@/data/mockTournaments";
import { mockBracketData } from "@/data/mockBrackets";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BracketTree } from "@/components/brackets/BracketTree";
import { AppLayout } from "@/components/layout/AppLayout";

export default function TournamentDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = params.id as string;

  const tournament = useMemo(() => {
    return mockTournaments.find((t) => t.id === tournamentId);
  }, [tournamentId]);

  const bracketData = useMemo(() => {
    return mockBracketData[tournamentId] || null;
  }, [tournamentId]);

  const showBracket =
    bracketData &&
    (tournament?.status === "in_progress" ||
      tournament?.status === "completed");

  if (!tournament) {
    return (
      <AppLayout>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-3xl font-bold mb-2">
              Tournament Not Found
            </h1>
            <Button onClick={() => router.push("/tournaments")}>
              Back to Tournaments
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="min-h-screen px-4 py-8">
        <div className="mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>

        <div className="container mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <TournamentHeader tournament={tournament} />
            <TournamentRules tournament={tournament} />
            <TournamentParticipants tournament={tournament} />

            {showBracket && (
              <div className="bg-card border rounded-lg p-6">
                <h3 className="font-semibold mb-4">
                  Tournament Bracket
                </h3>
                <BracketTree bracketData={bracketData} />
              </div>
            )}
          </div>

          <div className="space-y-6">
            <JoinTournamentButton tournament={tournament} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}