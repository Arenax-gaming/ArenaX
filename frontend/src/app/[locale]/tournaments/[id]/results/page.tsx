/**
 * /tournaments/[id]/results — server component wrapper
 *
 * Exports generateMetadata for OG / Twitter link preview cards
 * specific to the tournament win (champion name, prize pool).
 * The interactive page shell is in TournamentResultsPageClient.
 */

import type { Metadata } from "next";
import { mockTournaments } from "@/data/mockTournaments";
import { generateMockBracket } from "@/data/mockBracket";
import { getTournamentBannerUrl } from "@/lib/tournamentImageSizes";
import type { BracketData } from "@/types/bracket";
import { TournamentResultsPageClient } from "./TournamentResultsPageClient";

// ── Champion derivation (mirrors client-side findChampion) ────────────────────
function findChampionFromBracket(bracket: BracketData) {
  const lastSection = bracket.sections[bracket.sections.length - 1];
  if (!lastSection) return null;
  const finalRound = lastSection.rounds[lastSection.rounds.length - 1];
  if (!finalRound) return null;
  const finalMatch = finalRound.matches[finalRound.matches.length - 1];
  if (!finalMatch || finalMatch.status !== "completed" || !finalMatch.winnerId) {
    return null;
  }
  const sides = [finalMatch.player1, finalMatch.player2].filter(
    (p): p is NonNullable<typeof p> => p != null,
  );
  const winner = sides.find((p) => p.id === finalMatch.winnerId) ?? null;
  return winner;
}

// ── OG metadata ───────────────────────────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tournament = mockTournaments.find((t) => t.id === id);

  if (!tournament) {
    return { title: "Tournament Results — ArenaX" };
  }

  // Only completed tournaments have a real champion to feature.
  if (tournament.status !== "completed") {
    const title = `${tournament.name} — Results Pending | ArenaX`;
    const description = `Results for ${tournament.name} will be published once the tournament concludes.`;
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: [{ url: getTournamentBannerUrl(tournament.id) }],
      },
    };
  }

  // Derive champion server-side (no currentUserId needed for metadata).
  const bracket = generateMockBracket(tournament, "");
  const champion = findChampionFromBracket(bracket);

  const prize = tournament.prizePool.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  const winnerName = champion?.username ?? "The champion";
  const title = `🏆 ${winnerName} wins ${tournament.name} | ArenaX`;
  const description = `${winnerName} claimed the championship in "${tournament.name}" on ArenaX with a ${prize} prize pool!`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: getTournamentBannerUrl(tournament.id),
          width: 1200,
          height: 400,
          alt: `${tournament.name} tournament banner`,
        },
      ],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [getTournamentBannerUrl(tournament.id)],
    },
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function TournamentResultsPage() {
  return <TournamentResultsPageClient />;
}
