"use client";

/**
 * /tournaments/[id]/results (#324)
 *
 * Standalone results page for a completed tournament. The detail
 * page's "View Results" CTA on completed tournaments routes here.
 *
 * Behaviour matrix:
 *  - Unknown tournament id   → "Tournament not found" + back-to-list.
 *  - Tournament still in progress / registration_open → "Results
 *    pending" placeholder so the page doesn't 404 in non-terminal
 *    states; the link to the bracket / detail page is still surfaced.
 *  - Completed tournament   → final bracket + prize distribution +
 *    champion + runner-up.
 */

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";
import { ArrowLeft, Crown, Trophy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { mockTournaments } from "@/data/mockTournaments";
import { generateMockBracket } from "@/data/mockBracket";
import { TournamentHeader } from "@/components/tournaments/TournamentHeader";
import { SingleEliminationBracket } from "@/components/bracket/SingleEliminationBracket";
import { useAuth } from "@/hooks/useAuth";
import {
  calculatePrizeDistribution,
  type BracketData,
  type PrizeDistribution,
} from "@/types/bracket";

const findChampion = (bracket: BracketData) => {
  // The last round of the upper/main section that has a single
  // completed match identifies the champion.
  const lastSection = bracket.sections[bracket.sections.length - 1];
  if (!lastSection) return null;
  const finalRound =
    lastSection.rounds[lastSection.rounds.length - 1];
  if (!finalRound) return null;
  const finalMatch = finalRound.matches[finalRound.matches.length - 1];
  if (!finalMatch || finalMatch.status !== "completed" || !finalMatch.winnerId) {
    return null;
  }
  const sides = [finalMatch.player1, finalMatch.player2].filter(
    (p): p is NonNullable<typeof p> => p != null
  );
  const winner = sides.find(p => p.id === finalMatch.winnerId) ?? null;
  const runnerUp = sides.find(p => p.id !== finalMatch.winnerId) ?? null;
  return { winner, runnerUp, finalMatch };
};

const PrizeRow = ({ entry }: { entry: PrizeDistribution }) => (
  <li className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
    <span className={`font-semibold ${entry.highlight ?? "text-foreground"}`}>
      #{entry.position} · {entry.label}
    </span>
    <span className="font-medium text-foreground">
      ${entry.amount.toLocaleString()}
      <span className="ml-2 text-xs text-muted-foreground">
        ({entry.percentage}%)
      </span>
    </span>
  </li>
);

export default function TournamentResultsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const tournamentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const currentUserId = user?.id ?? "user-123";

  const tournament = useMemo(
    () => mockTournaments.find(t => t.id === tournamentId),
    [tournamentId]
  );

  const bracketData = useMemo(() => {
    if (!tournament) return null;
    return generateMockBracket(tournament, currentUserId);
  }, [tournament, currentUserId]);

  const prizeDistribution = useMemo(
    () =>
      tournament
        ? calculatePrizeDistribution(tournament.prizePool)
        : [],
    [tournament]
  );

  if (!tournament) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="mb-2 text-3xl font-bold text-foreground">
            Tournament Not Found
          </h1>
          <p className="mb-6 text-muted-foreground">
            The tournament you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={() => router.push("/tournaments")}>
            Back to Tournaments
          </Button>
        </div>
      </div>
    );
  }

  // Non-terminal states get a friendly "results pending" page rather
  // than a 404 — the page is reachable for completed tournaments via
  // the View Results CTA, but link-sharing can land users here while
  // the tournament is still running.
  const isResultsPending =
    tournament.status === "registration_open" ||
    tournament.status === "registration_closed" ||
    tournament.status === "in_progress";

  const champion = bracketData ? findChampion(bracketData) : null;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Link href={`/tournaments/${tournament.id}`}>
          <Button variant="outline" size="sm">
            Tournament details
          </Button>
        </Link>
      </div>

      <div className="space-y-8">
        <TournamentHeader tournament={tournament} />

        {isResultsPending ? (
          <section
            className="rounded-xl border border-border bg-card p-8 text-center"
            data-testid="results-pending"
          >
            <Trophy
              className="mx-auto mb-3 h-10 w-10 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 className="mb-2 text-2xl font-bold text-foreground">
              Results pending
            </h2>
            <p className="mx-auto max-w-md text-muted-foreground">
              This tournament is still
              {tournament.status === "in_progress"
                ? " in progress"
                : " in its registration phase"}
              . Final results and prize distribution will be published here
              once the tournament concludes.
            </p>
            {tournament.status === "in_progress" && (
              <Link
                href={`/tournaments/${tournament.id}`}
                className="mt-4 inline-block"
              >
                <Button>View live bracket</Button>
              </Link>
            )}
          </section>
        ) : (
          <>
            {champion?.winner && (
              <section
                className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-6"
                aria-labelledby="champion-heading"
              >
                <h2
                  id="champion-heading"
                  className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-amber-300"
                >
                  <Crown className="h-4 w-4" aria-hidden="true" />
                  Champion
                </h2>
                <p className="text-3xl font-black text-foreground">
                  {champion.winner.username}
                </p>
                {champion.runnerUp && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Runner-up: {champion.runnerUp.username}
                  </p>
                )}
              </section>
            )}

            <section aria-labelledby="prize-heading" className="space-y-3">
              <h2
                id="prize-heading"
                className="text-lg font-bold text-foreground"
              >
                Prize distribution
              </h2>
              <ul className="space-y-2">
                {prizeDistribution.map(entry => (
                  <PrizeRow key={entry.position} entry={entry} />
                ))}
              </ul>
            </section>

            {bracketData && (
              <section aria-labelledby="bracket-heading" className="space-y-4">
                <h2
                  id="bracket-heading"
                  className="text-lg font-bold text-foreground"
                >
                  Final bracket
                </h2>
                <SingleEliminationBracket
                  data={bracketData}
                  currentUserId={currentUserId}
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
