"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { mockTournaments } from "@/data/mockTournaments";
import { RegistrationForm } from "@/components/tournaments/RegistrationForm";
import { Button } from "@/components/ui/Button";
import { ArrowLeft, AlertCircle } from "lucide-react";

export default function TournamentRegisterPage() {
  const params = useParams();
  const router = useRouter();
  const tournamentId = params.id as string;

  const tournament = useMemo(
    () => mockTournaments.find((t) => t.id === tournamentId),
    [tournamentId],
  );

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

  const canRegister = tournament.status === "registration_open" &&
    tournament.currentParticipants < tournament.maxParticipants;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-lg">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="mb-6 gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Tournament Registration</h1>
          <p className="mt-1 text-muted-foreground">
            Complete your registration for{" "}
            <span className="font-medium text-foreground">{tournament.name}</span>
          </p>
        </div>

        {!canRegister ? (
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-6 dark:border-orange-900 dark:bg-orange-950/20">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 flex-shrink-0 text-orange-600 dark:text-orange-400" />
              <div>
                <p className="font-semibold text-orange-900 dark:text-orange-100">
                  Registration Unavailable
                </p>
                <p className="mt-1 text-sm text-orange-800 dark:text-orange-200">
                  {tournament.status !== "registration_open"
                    ? `This tournament is currently ${tournament.status.replace(/_/g, " ")}.`
                    : "This tournament is full."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => router.push(`/tournaments/${tournament.id}`)}
                >
                  View Tournament
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <RegistrationForm
              tournament={tournament}
              onSuccess={() => router.push(`/tournaments/${tournament.id}`)}
              onCancel={() => router.back()}
            />
          </div>
        )}
      </div>
    </div>
  );
}
