import type { MatchWithPlayers, MatchHistoryFilters, PrivacySetting } from '@/types/profile';

export function computeWinRate(wins: number, losses: number): number {
  const total = wins + losses;
  if (total === 0) return 0;
  return Math.round((wins / total) * 1000) / 10;
}

export function isSectionVisible(
  setting: PrivacySetting,
  viewerRelation: 'owner' | 'friend' | 'public'
): boolean {
  if (setting === 'everyone') return true;
  if (setting === 'friends') return viewerRelation === 'owner' || viewerRelation === 'friend';
  return viewerRelation === 'owner';
}

export function filterMatches(
  matches: MatchWithPlayers[],
  currentUserId: string,
  filters: MatchHistoryFilters
): MatchWithPlayers[] {
  return matches.filter(match => {
    const isWin = match.winnerId === currentUserId;
    const opponentName =
      match.player1Id === currentUserId ? match.player2Username : match.player1Username;

    if (filters.gameType && match.gameType !== filters.gameType) return false;
    if (filters.result === 'win' && !isWin) return false;
    if (filters.result === 'loss' && isWin) return false;
    if (
      filters.opponentSearch &&
      !opponentName.toLowerCase().includes(filters.opponentSearch.toLowerCase())
    )
      return false;
    return true;
  });
}

export function validateAvatarFile(file: {
  size: number;
  type: string;
}): { valid: boolean; error?: string } {
  const MAX_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  if (file.size > MAX_SIZE) return { valid: false, error: 'File size must not exceed 5MB' };
  if (!ALLOWED_TYPES.includes(file.type))
    return { valid: false, error: 'File type must be JPEG, PNG, or WebP' };
  return { valid: true };
}
