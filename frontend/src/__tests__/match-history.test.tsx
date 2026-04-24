/**
 * Feature: player-profile, Property 7 (UI layer): filtered rows match active filter
 *
 * For any filtered match list, all rendered rows should match the active filter.
 * Validates: Requirements 4.2, 4.3, 4.4
 */

import React from "react";
import * as fc from "fast-check";
import { render, screen } from "@testing-library/react";
import { MatchHistory } from "@/components/profile/MatchHistory";
import type { MatchWithPlayers } from "@/types/match";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const CURRENT_USER_ID = "user-1";
const OPPONENT_ID = "user-2";

/** Build a MatchWithPlayers where player1 is always the current user */
const matchArb = fc.record<MatchWithPlayers>({
  id: fc.uuid(),
  player1Id: fc.constant(CURRENT_USER_ID),
  player2Id: fc.constant(OPPONENT_ID),
  player1Username: fc.constant("CurrentUser"),
  player2Username: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  winnerId: fc.constantFrom(CURRENT_USER_ID, OPPONENT_ID),
  gameType: fc.constantFrom("chess", "checkers", "go"),
  status: fc.constant("completed" as const),
  scorePlayer1: fc.nat({ max: 10 }),
  scorePlayer2: fc.nat({ max: 10 }),
  createdAt: fc.constant("2024-01-01T00:00:00Z"),
  completedAt: fc.constant("2024-01-01T01:00:00Z"),
});

// ---------------------------------------------------------------------------
// Property 7 (UI layer): filtered rows match active result filter
// ---------------------------------------------------------------------------

describe("MatchHistory — Property 7 (UI layer)", () => {
  it("all rendered Win/Loss badges match the active result filter", () => {
    fc.assert(
      fc.property(
        fc.array(matchArb, { minLength: 1, maxLength: 15 }),
        fc.constantFrom<"win" | "loss">("win", "loss"),
        (matches, resultFilter) => {
          const { unmount } = render(
            <MatchHistory
              matches={matches}
              currentUserId={CURRENT_USER_ID}
              filters={{ result: resultFilter }}
            />
          );

          // Collect all badge texts — they are the small "Win" / "Loss" labels
          const winBadges = screen.queryAllByText("Win");
          const lossBadges = screen.queryAllByText("Loss");

          let passed: boolean;
          if (resultFilter === "win") {
            // Only Win badges should appear; no Loss badges
            passed = lossBadges.length === 0;
          } else {
            // Only Loss badges should appear; no Win badges
            passed = winBadges.length === 0;
          }

          unmount();
          return passed;
        }
      ),
      { numRuns: 100 }
    );
  });
});
