import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Tournament, TournamentFilters, TournamentTeamSize } from "@/types/tournament";

/**
 * Builds a flat params object from TournamentFilters, stripping undefined
 * values so URLSearchParams doesn't produce stray `key=undefined` entries.
 */
function filtersToParams(
  filters: TournamentFilters,
): Record<string, string> {
  const p: Record<string, string> = {};
  if (filters.search)          p.search          = filters.search;
  if (filters.status)          p.status          = filters.status;
  if (filters.pageStatus)      p.pageStatus      = filters.pageStatus;
  if (filters.gameType)        p.gameType        = filters.gameType;
  if (filters.tournamentType)  p.tournamentType  = filters.tournamentType;
  if (filters.visibility)      p.visibility      = filters.visibility;
  if (filters.sortBy)          p.sortBy          = filters.sortBy;
  if (filters.sortOrder)       p.sortOrder       = filters.sortOrder;
  if (filters.page !== undefined)         p.page          = String(filters.page);
  if (filters.limit !== undefined)        p.limit         = String(filters.limit);
  if (filters.minEntryFee !== undefined)  p.minEntryFee   = String(filters.minEntryFee);
  if (filters.maxEntryFee !== undefined)  p.maxEntryFee   = String(filters.maxEntryFee);
  if (filters.minPrizePool !== undefined) p.minPrizePool  = String(filters.minPrizePool);
  if (filters.maxPrizePool !== undefined) p.maxPrizePool  = String(filters.maxPrizePool);
  return p;
}

/**
 * Fetches tournaments from the API with optional filters.
 * Every filter change produces a new API call — no client-side filtering.
 * Previous page results stay visible (`isPlaceholderData`) while the next
 * page is fetching, so the list can render skeletons below existing cards.
 */
export function useTournaments(filters: TournamentFilters = {}) {
  return useQuery<Tournament[]>({
    queryKey: ["tournaments", filters],
    queryFn: async () => {
      const params = filtersToParams(filters);
      const data = await api.getTournaments(
        Object.keys(params).length > 0 ? params : undefined,
      );
      // api.getTournaments returns unknown — coerce to Tournament[]
      return (data ?? []) as Tournament[];
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Fetches the list of tournament IDs the authenticated user has joined.
 * Stores a plain string[] in the cache (Sets aren't JSON-serialisable) and
 * converts to a Set at call sites via the `joinedSet` helper below.
 */
export function useJoinedTournaments(userId: string | undefined) {
  return useQuery<string[]>({
    queryKey: ["joinedTournaments", userId],
    queryFn: async () => {
      const data = await api.getJoinedTournaments();
      return (data ?? []).map((t) => t.id);
    },
    enabled: !!userId,
    staleTime: 60_000,
    retry: 1,
  });
}

// ─── Team roster helpers (issue #1565) ──────────────────────────────────────

/** Default team-size config for tournaments that don't specify one (solo). */
const SOLO_TEAM_SIZE: TournamentTeamSize = { min: 1, max: 1 };

/**
 * Resolves the effective team-size config for a tournament, defaulting to a
 * solo (1/1) roster when the tournament doesn't define one.
 */
export function getTournamentTeamSize(
  tournament: Pick<Tournament, "teamSize">,
): TournamentTeamSize {
  const size = tournament.teamSize;
  if (!size || size.max < 1) return SOLO_TEAM_SIZE;
  return {
    min: Math.max(1, Math.min(size.min, size.max)),
    max: size.max,
  };
}

/** True when a tournament requires a multi-player roster (not solo entry). */
export function isTeamTournament(tournament: Pick<Tournament, "teamSize">): boolean {
  return getTournamentTeamSize(tournament).max > 1;
}

export interface RosterValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a drag-and-drop team roster against the tournament's team-size
 * config. Catches: too few players, too many players, and duplicate players
 * occupying more than one slot.
 */
export function validateRoster(
  roster: Array<string | null>,
  teamSize: TournamentTeamSize,
): RosterValidationResult {
  const errors: string[] = [];
  const filled = roster.filter((id): id is string => !!id);

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of filled) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) {
    errors.push("Duplicate players are not allowed on the roster.");
  }

  const uniqueCount = seen.size;
  if (uniqueCount < teamSize.min) {
    errors.push(
      `This tournament requires at least ${teamSize.min} player${teamSize.min === 1 ? "" : "s"} (${uniqueCount} selected).`,
    );
  }
  if (uniqueCount > teamSize.max) {
    errors.push(
      `This tournament allows at most ${teamSize.max} player${teamSize.max === 1 ? "" : "s"} (${uniqueCount} selected).`,
    );
  }

  return { valid: errors.length === 0, errors };
}
