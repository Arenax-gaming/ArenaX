/** Banner on the join page (single-column layout, max-w-lg). */
export const TOURNAMENT_JOIN_BANNER_SIZES = "(max-width: 640px) 100vw, 512px";

/** Banner on the tournament detail page (two-thirds of a 1280px grid). */
export const TOURNAMENT_DETAIL_BANNER_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 100vw, 66vw";

/** Banner in the tournament card grid (one card per row up to 3 columns). */
export const TOURNAMENT_GRID_IMAGE_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

export function getTournamentBannerUrl(tournamentId: string): string {
  return `https://api.dicebear.com/7.x/abstract/png?seed=arenax-tournament-${tournamentId}&width=1200&height=400`;
}

export function resolveTournamentBanner(tournament: {
  id: string;
  banner?: string | null;
}): string {
  return tournament.banner?.trim() || getTournamentBannerUrl(tournament.id);
}
