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