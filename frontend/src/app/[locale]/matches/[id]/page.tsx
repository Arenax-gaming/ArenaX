import type { Metadata } from "next";
import { matchHubDetails } from "@/data/matchHub";
import { MatchHubPageClient } from "./MatchHubPageClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const match = matchHubDetails[id];

  // Real matches are fetched live client-side and won't always be present in
  // this mock lookup. That's expected — this is best-effort SEO metadata,
  // not a data source for the page itself.
  if (!match) {
    return {
      title: "Match — ArenaX",
      description: "View live match details on ArenaX.",
    };
  }

  const title = `${match.player1.username} vs ${match.player2.username} — ArenaX`;
  const description = match.notes
    ? match.notes.slice(0, 155)
    : `${match.tournamentName} · ${match.roundLabel} — watch live match details on ArenaX.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
    },
  };
}

export default function MatchHubPage() {
  return <MatchHubPageClient />;
}
