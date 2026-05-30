// Tournament-related types
export interface Tournament {
  id: string;
  name: string;
  description?: string;
  gameType: string;
  tournamentType: string;
  entryFee: number;
  prizePool: number;
  maxParticipants: number;
  currentParticipants: number;
  status: TournamentStatus;
  visibility: TournamentVisibility;
  startTime: string;
  endTime?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type TournamentStatus =
  | 'draft'
  | 'registration_open'
  | 'registration_closed'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

/** Simplified status buckets for the tournaments list UI (badges, colors, filters). */
export type TournamentPageStatus = 'ongoing' | 'upcoming' | 'completed';

export const TOURNAMENT_PAGE_STATUSES: TournamentPageStatus[] = [
  'ongoing',
  'upcoming',
  'completed',
];

export const TOURNAMENT_PAGE_STATUS_COLORS: Record<
  TournamentPageStatus,
  { badgeClass: string; label: string }
> = {
  ongoing: {
    badgeClass:
      'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200',
    label: 'Ongoing',
  },
  upcoming: {
    badgeClass:
      'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200',
    label: 'Upcoming',
  },
  completed: {
    badgeClass:
      'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-200',
    label: 'Completed',
  },
};

export function toTournamentPageStatus(status: TournamentStatus): TournamentPageStatus {
  if (status === 'in_progress') {
    return 'ongoing';
  }
  if (status === 'completed' || status === 'cancelled') {
    return 'completed';
  }
  return 'upcoming';
}

export function isTournamentPageStatus(value: string): value is TournamentPageStatus {
  return (TOURNAMENT_PAGE_STATUSES as readonly string[]).includes(value);
}

export type TournamentVisibility =
  | 'public'
  | 'private'
  | 'invite_only';

export type TournamentType =
  | 'single_elimination'
  | 'double_elimination'
  | 'round_robin'
  | 'swiss';

export interface CreateTournamentRequest {
  name: string;
  description?: string;
  gameType: string;
  tournamentType: TournamentType;
  entryFee: number;
  maxParticipants: number;
  visibility: TournamentVisibility;
  startTime: string;
}

export interface TournamentFilters {
  gameType?: string;
  status?: TournamentStatus;
  /** Filter by simplified list status (ongoing / upcoming / completed). */
  pageStatus?: TournamentPageStatus;
  visibility?: TournamentVisibility;
  tournamentType?: TournamentType;
  minEntryFee?: number;
  maxEntryFee?: number;
  minPrizePool?: number;
  maxPrizePool?: number;
  search?: string;
  sortBy?: 'date' | 'prize_pool' | 'participants';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}