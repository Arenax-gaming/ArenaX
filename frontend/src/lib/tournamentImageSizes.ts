/** Banner on the join page (single-column layout, max-w-lg). */
export const TOURNAMENT_JOIN_BANNER_SIZES = "(max-width: 640px) 100vw, 512px";

export function getTournamentBannerUrl(tournamentId: string): string {
  return `https://api.dicebear.com/7.x/abstract/png?seed=arenax-tournament-${tournamentId}&width=1200&height=400`;
}

export function resolveTournamentBanner(tournament: {
  id: string;
  banner?: string | null;
}): string {
  return tournament.banner?.trim() || getTournamentBannerUrl(tournament.id);
}
