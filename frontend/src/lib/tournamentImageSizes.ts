/** Responsive sizes for tournament cards in the 1 / 2 / 3 column grid (sm / md / lg). */
export const TOURNAMENT_GRID_IMAGE_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

/** Banner on the detail page (full width below lg, ~2/3 of viewport in the main column). */
export const TOURNAMENT_DETAIL_BANNER_SIZES =
  "(max-width: 1024px) 100vw, 66vw";

export function getTournamentBannerUrl(tournamentId: string): string {
  return `https://api.dicebear.com/7.x/abstract/png?seed=arenax-tournament-${tournamentId}&width=1200&height=400`;
}
