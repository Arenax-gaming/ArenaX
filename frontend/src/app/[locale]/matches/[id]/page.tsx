import type { Metadata } from "next";
import { MatchHubPageClient } from "./MatchHubPageClient";

// Match metadata is resolved client-side from the live API.
// Static fixture data is intentionally not used here — SEO metadata is
// generic so that no production code depends on fixture files.
export function generateMetadata(): Metadata {
  return {
    title: "Match — ArenaX",
    description: "View live match details on ArenaX.",
  };
}

export default function MatchHubPage() {
  return <MatchHubPageClient />;
}
