import * as fc from 'fast-check';
import {
  computeWinRate,
  isSectionVisible,
  filterMatches,
  validateAvatarFile,
} from '@/lib/profile-utils';
import type { MatchWithPlayers, PrivacySetting } from '@/types/profile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const privacySettings: PrivacySetting[] = ['everyone', 'friends', 'only_me'];
const viewerRelations = ['owner', 'friend', 'public'] as const;
const nonOwnerRelations = ['friend', 'public'] as const;

const matchArb = fc.record<MatchWithPlayers>({
  id: fc.uuid(),
  player1Id: fc.constant('p1'),
  player2Id: fc.constant('p2'),
  player1Username: fc.string({ minLength: 1, maxLength: 20 }),
  player2Username: fc.string({ minLength: 1, maxLength: 20 }),
  winnerId: fc.constantFrom('p1', 'p2'),
  gameType: fc.constantFrom('chess', 'checkers', 'go'),
  score: fc.constant('1-0'),
  date: fc.constant('2024-01-01'),
});

// ---------------------------------------------------------------------------
// Task 1.1 — computeWinRate
// ---------------------------------------------------------------------------

describe('computeWinRate', () => {
  // Feature: player-profile, Property 1: Win rate is always in range [0, 100]
  it('Property 1: win rate is always in range [0, 100]', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (wins, losses) => {
        const rate = computeWinRate(wins, losses);
        return rate >= 0 && rate <= 100;
      }),
      { numRuns: 100 }
    );
  });

  // Feature: player-profile, Property 2: Win rate with zero matches returns 0
  it('Property 2: win rate with zero matches returns 0', () => {
    expect(computeWinRate(0, 0)).toBe(0);
  });

  // Feature: player-profile, Property 3: Win rate scale invariance
  it('Property 3: win rate is scale-invariant', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1000 }),
        fc.nat({ max: 1000 }),
        fc.integer({ min: 1, max: 100 }),
        (wins, losses, k) => {
          // Only test when there are matches to avoid 0/0 edge case
          if (wins + losses === 0) return true;
          const base = computeWinRate(wins, losses);
          const scaled = computeWinRate(wins * k, losses * k);
          return Math.abs(base - scaled) < 0.01;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Task 1.2 — isSectionVisible
// ---------------------------------------------------------------------------

describe('isSectionVisible', () => {
  // Feature: player-profile, Property 4: Owner always sees all sections
  it('Property 4: owner always sees all sections', () => {
    fc.assert(
      fc.property(fc.constantFrom(...privacySettings), setting => {
        return isSectionVisible(setting, 'owner') === true;
      }),
      { numRuns: 100 }
    );
  });

  // Feature: player-profile, Property 5: only_me hides from non-owners
  it('Property 5: only_me hides from non-owners', () => {
    fc.assert(
      fc.property(fc.constantFrom(...nonOwnerRelations), relation => {
        return isSectionVisible('only_me', relation) === false;
      }),
      { numRuns: 100 }
    );
  });

  // Feature: player-profile, Property 6: everyone is always visible
  it('Property 6: everyone is always visible', () => {
    fc.assert(
      fc.property(fc.constantFrom(...viewerRelations), relation => {
        return isSectionVisible('everyone', relation) === true;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Task 1.3 — filterMatches
// ---------------------------------------------------------------------------

describe('filterMatches', () => {
  const currentUserId = 'p1';

  // Feature: player-profile, Property 7: Win filter correctness
  it('Property 7: win filter returns only matches where currentUser won', () => {
    fc.assert(
      fc.property(fc.array(matchArb, { maxLength: 20 }), matches => {
        const result = filterMatches(matches, currentUserId, { result: 'win' });
        return result.every(m => m.winnerId === currentUserId);
      }),
      { numRuns: 100 }
    );
  });

  // Feature: player-profile, Property 8: Opponent search is case-insensitive
  it('Property 8: opponent search is case-insensitive', () => {
    fc.assert(
      fc.property(
        fc.array(matchArb, { maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 5 }),
        (matches, search) => {
          const lower = filterMatches(matches, currentUserId, { opponentSearch: search });
          const upper = filterMatches(matches, currentUserId, {
            opponentSearch: search.toUpperCase(),
          });
          if (lower.length !== upper.length) return false;
          return lower.every((m, i) => m.id === upper[i].id);
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: player-profile, Property 9: Filter result is a subset of input
  it('Property 9: filtered result is always a subset of the input', () => {
    fc.assert(
      fc.property(
        fc.array(matchArb, { maxLength: 20 }),
        fc.record({
          gameType: fc.option(fc.constantFrom('chess', 'checkers', 'go'), { nil: undefined }),
          result: fc.option(fc.constantFrom<'win' | 'loss'>('win', 'loss'), { nil: undefined }),
          opponentSearch: fc.option(fc.string({ maxLength: 10 }), { nil: undefined }),
        }),
        (matches, filters) => {
          const result = filterMatches(matches, currentUserId, filters);
          const inputIds = new Set(matches.map(m => m.id));
          return result.every(m => inputIds.has(m.id));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Task 1.4 — validateAvatarFile
// ---------------------------------------------------------------------------

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DISALLOWED_TYPES = ['image/gif', 'image/bmp', 'application/pdf', 'text/plain', 'video/mp4'];

describe('validateAvatarFile', () => {
  // Feature: player-profile, Property 12: Rejects files with size > 5MB
  it('Property 12: rejects files with size > 5MB', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_SIZE + 1, max: MAX_SIZE * 10 }),
        fc.constantFrom(...ALLOWED_TYPES),
        (size, type) => {
          const result = validateAvatarFile({ size, type });
          return result.valid === false && typeof result.error === 'string';
        }
      ),
      { numRuns: 100 }
    );
  });

  // Feature: player-profile, Property 13: Rejects files with unsupported MIME types
  it('Property 13: rejects files with unsupported MIME types', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_SIZE }),
        fc.constantFrom(...DISALLOWED_TYPES),
        (size, type) => {
          const result = validateAvatarFile({ size, type });
          return result.valid === false && typeof result.error === 'string';
        }
      ),
      { numRuns: 100 }
    );
  });
});
