import type { Metadata } from "next";
import { mockTournaments } from "@/data/mockTournaments";
import { TournamentDetailsPageClient } from "./TournamentDetailsPageClient";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ match?: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { match: matchId } = await searchParams;
  const tournament = mockTournaments.find((t) => t.id === id);

  if (!tournament) {
    return { title: "Tournament Not Found" };
  }

  // #1089: a deep-linked match gets its own title/description for link
  // unfurling (Discord/Twitter previews), instead of the generic tournament
  // page preview.
  const title = matchId
    ? `Match ${matchId} — ${tournament.name} — ArenaX`
    : `${tournament.name} — ArenaX`;
  const description = matchId
    ? `Watch this bracket match live from "${tournament.name}" on ArenaX.`
    : tournament.description
      ? tournament.description.slice(0, 155)
      : `Join ${tournament.name} on ArenaX.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: tournament.banner ? [{ url: tournament.banner }] : undefined,
    },
  };
}

export default function TournamentDetailsPage() {
  return <TournamentDetailsPageClient />;
}
