"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { TournamentHeader } from "@/components/tournaments/TournamentHeader";
import { TournamentRules } from "@/components/tournaments/TournamentRules";
import { TournamentParticipants } from "@/components/tournaments/TournamentParticipants";
import { JoinTournamentButton } from "@/components/tournaments/JoinTournamentButton";
import { SingleEliminationBracket } from "@/components/bracket/SingleEliminationBracket";
import { mockTournaments } from "@/data/mockTournaments";
import { generateMockBracket } from "@/data/mockBracket";
import { ArrowLeft, RadioTower, ShieldAlert, Swords, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/hooks/useAuth";

export default function TournamentDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const tournamentId = params.id as string;
  const currentUserId = user?.id ?? "user-123";

  const tournament = useMemo(
    () => mockTournaments.find((candidate) => candidate.id === tournamentId),
    [tournamentId],
  );

  const bracketData = useMemo(() => {
    if (!tournament) {
      return null;
    }

    if (tournament.status === "in_progress" || tournament.status === "completed") {
      return generateMockBracket(tournament, currentUserId);
    }

    return null;
  }, [currentUserId, tournament]);

  if (!tournament) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="mb-2 text-3xl font-bold text-foreground">Tournament Not Found</h1>
          <p className="mb-6 text-muted-foreground">
            The tournament you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={() => router.push("/tournaments")}>Back to Tournaments</Button>
        </div>
      </div>
    );
  }

  const showBracket = tournament.status === "in_progress" || tournament.status === "completed";
  const highlightedMatchId =
    tournament.id === "2" ? "2-match-10" : tournament.id === "1" ? "1-match-13" : null;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <TournamentHeader tournament={tournament} />

          {showBracket && bracketData ? (
            <section className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <HighlightCard
                  icon={<Swords className="h-4 w-4 text-cyan-300" />}
                  title="Bracket Intelligence"
                  value={
                    bracketData.format === "double_elimination"
                      ? "Upper, lower, and finals flow"
                      : "Full single-elim progression"
                  }
                />
                <HighlightCard
                  icon={<RadioTower className="h-4 w-4 text-emerald-300" />}
                  title="Live Coverage"
                  value={`${bracketData.activeMatchIds?.length ?? 0} active match nodes`}
                />
                <HighlightCard
                  icon={<ShieldAlert className="h-4 w-4 text-rose-300" />}
                  title="Dispute Handling"
                  value="Conflict states visible in bracket and hub"
                />
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.35em] text-cyan-700/70">
                      Live Experience
                    </p>
                    <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                      Tournament Progress Hub
                    </h2>
                    <p className="mt-2 max-w-2xl text-sm text-slate-600">
                      Built to spotlight momentum, byes, live progression, and the current player path without sacrificing clarity on smaller screens.
                    </p>
                  </div>

                  {highlightedMatchId ? (
                    <Link href={`/matches/${highlightedMatchId}`}>
                      <Button className="gap-2">
                        Open Match Hub
                        <RadioTower className="h-4 w-4" />
                      </Button>
                    </Link>
                  ) : null}
                </div>

                <SingleEliminationBracket
                  bracketData={bracketData}
                  currentUserId={currentUserId}
                />
              </div>
            </section>
          ) : null}

          <TournamentRules tournament={tournament} />
          <TournamentParticipants tournament={tournament} />
        </div>

        <div className="space-y-6">
          <JoinTournamentButton tournament={tournament} />
          <div className="sticky top-24 rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="font-semibold text-foreground">Quick Stats</h3>
            <div className="mt-5 space-y-4">
              <SidebarRow
                label="Entry Fee"
                value={tournament.entryFee === 0 ? "Free" : `$${tournament.entryFee}`}
              />
              <SidebarRow
                label="Prize Pool"
                value={`$${tournament.prizePool.toLocaleString()}`}
              />
              <SidebarRow
                label="Match Format"
                value={tournament.tournamentType.replace(/_/g, " ")}
              />
              <SidebarRow
                label="Total Slots"
                value={String(tournament.maxParticipants)}
              />
            </div>

            {highlightedMatchId ? (
              <div className="mt-6 rounded-3xl border border-cyan-200 bg-cyan-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-cyan-900">
                  <Trophy className="h-4 w-4" />
                  Featured Match Hub
                </div>
                <p className="mt-2 text-sm text-cyan-800">
                  Review live score feed, dual player reporting, and dispute states.
                </p>
                <Link href={`/matches/${highlightedMatchId}`} className="mt-4 inline-block">
                  <Button size="sm">Launch Hub</Button>
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function HighlightCard({
  icon,
  title,
  value,
}: {
  icon: ReactNode;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(30,41,59,0.92))] p-5 text-white shadow-[0_20px_60px_-45px_rgba(15,23,42,0.9)]">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-300">{value}</p>
    </div>
  );
}

function SidebarRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b pb-3 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-semibold capitalize text-foreground">{value}</span>
    </div>
  );
}
