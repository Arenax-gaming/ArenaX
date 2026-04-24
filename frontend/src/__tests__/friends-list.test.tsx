/**
 * Feature: player-profile, Property 11 (friends): rendered order follows online → in-game → offline
 *
 * For any list of friends, the rendered order should place online friends first,
 * then in-game, then offline. No 'online' appears after 'in-game' or 'offline',
 * and no 'in-game' appears after 'offline'.
 * Validates: Requirements 6.1
 */

import React from "react";
import * as fc from "fast-check";
import { render, screen } from "@testing-library/react";
import { FriendsList } from "@/components/profile/FriendsList";
import type { FriendEntry } from "@/types/profile";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const STATUS_ORDER: Record<FriendEntry["status"], number> = {
  online: 0,
  "in-game": 1,
  offline: 2,
};

const friendArb = fc.record<FriendEntry>({
  id: fc.uuid(),
  username: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  elo: fc.integer({ min: 0, max: 3000 }),
  status: fc.constantFrom<FriendEntry["status"]>("online", "in-game", "offline"),
});

// ---------------------------------------------------------------------------
// Property 11 (friends): rendered order follows online → in-game → offline
// ---------------------------------------------------------------------------

describe("FriendsList — Property 11 (friends): ordering", () => {
  it("renders friends in online → in-game → offline order for any input", () => {
    fc.assert(
      fc.property(
        fc.array(friendArb, { minLength: 1, maxLength: 20 }),
        (friends) => {
          const { unmount } = render(
            <FriendsList friends={friends} isOwner={false} />
          );

          const indicators = screen.queryAllByTestId("status-indicator");
          const statuses = indicators.map(
            (el) => el.getAttribute("data-status") as FriendEntry["status"]
          );

          // Verify the sequence is non-decreasing in STATUS_ORDER
          let passed = true;
          for (let i = 1; i < statuses.length; i++) {
            if (STATUS_ORDER[statuses[i]] < STATUS_ORDER[statuses[i - 1]]) {
              passed = false;
              break;
            }
          }

          unmount();
          return passed;
        }
      ),
      { numRuns: 100 }
    );
  });
});
