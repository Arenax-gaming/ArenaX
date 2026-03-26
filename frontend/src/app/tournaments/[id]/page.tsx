"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { TournamentHeader } from "@/components/tournaments/TournamentHeader";
import { TournamentRules } from "@/components/tournaments/TournamentRules";
import { TournamentParticipants } from "@/components/tournaments/TournamentParticipants";
import { JoinTournamentButton } from "@/components/tournaments/JoinTournamentButton";
import { SingleEliminationBracket } from "@/components/bracket/SingleEliminationBracket";
import { mockTournaments } from "@/data/mockTournaments";
import { generateMockBracket } from "@/data/mockBracket";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";

export default function TournamentDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const tournamentId = params.id as string;

  const tournament = useMemo(() => {
    return mockTournaments.find((t) => t.id === tournamentId);
  }, [tournamentId]);

  // Generate bracket data for tournaments that are in progress or completed
  const bracketData = useMemo(() => {
    if (!tournament) return null;
    if (tournament.status === "in_progress" || tournament.status === "completed") {
      return generateMockBracket(tournamentId);
    }
    return null;
  }, [tournament, tournamentId]);

  // If not found, show minimal page
  if (!tournament) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Tournament Not Found
          </h1>
          <p className="text-muted-foreground mb-6">
            The tournament you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={() => router.push("/tournaments")}>
            Back to Tournaments
          </Button>
        </div>
      </div>
    );
  }

  const showBracket = tournament.status === "in_progress" || tournament.status === "completed";

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      {/* Back Button */}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          <TournamentHeader tournament={tournament} />
          
          {/* Bracket Section - Show for in_progress and completed tournaments */}
          {showBracket && bracketData && (
            <div className="bg-card border rounded-lg p-6">
              <h2 className="text-xl font-semibold text-foreground mb-4">
                Tournament Bracket
              </h2>
              <div className="overflow-x-auto">
                <SingleEliminationBracket
                  bracketData={bracketData}
                  currentUserId={user?.id}
                />
              </div>
            </div>
          )}

          <TournamentRules tournament={tournament} />
          <TournamentParticipants tournament={tournament} />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <JoinTournamentButton tournament={tournament} />
          <div className="bg-card border rounded-lg p-6 sticky top-24">
            <h3 className="font-semibold text-foreground mb-4">
              Quick Stats
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Entry Fee</span>
                <span className="font-semibold text-foreground">
                  {tournament.entryFee === 0 ? "Free" : `$${tournament.entryFee}`}
                </span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Prize Pool</span>
                <span className="font-semibold text-foreground">
                  ${tournament.prizePool.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm text-muted-foreground">Match Format</span>
                <span className="font-semibold text-foreground capitalize">
                  {tournament.tournamentType.replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total Slots</span>
                <span className="font-semibold text-foreground">
                  {tournament.maxParticipants}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
