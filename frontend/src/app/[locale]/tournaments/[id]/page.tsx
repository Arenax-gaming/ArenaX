import type { Metadata } from "next";
import { mockTournaments } from "@/data/mockTournaments";
import { TournamentDetailsPageClient } from "./TournamentDetailsPageClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const tournament = mockTournaments.find((t) => t.id === id);

  if (!tournament) {
    return { title: "Tournament Not Found" };
  }

  const title = `${tournament.name} — ArenaX`;
  const description = tournament.description
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
