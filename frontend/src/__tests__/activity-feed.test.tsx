/**
 * Feature: player-profile, Property 11: Activity feed is in reverse chronological order
 *
 * For any list of activity events, the rendered feed should display them sorted by
 * timestamp descending (most recent first).
 * Validates: Requirements 7.5
 */

import React from "react";
import * as fc from "fast-check";
import { render, screen } from "@testing-library/react";
import { ActivityFeed } from "@/components/profile/ActivityFeed";
import type { ActivityEvent, ActivityEventType } from "@/types/profile";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const EVENT_TYPES: ActivityEventType[] = [
  "match_completed",
  "achievement_unlocked",
  "tournament_joined",
  "tournament_completed",
  "friend_added",
];

const activityArb = fc.record<ActivityEvent>({
  id: fc.uuid(),
  type: fc.constantFrom(...EVENT_TYPES),
  timestamp: fc
    .integer({ min: 0, max: Date.now() })
    .map((n) => new Date(n).toISOString()),
  payload: fc.constant({
    opponent: "Player",
    result: "Win",
    achievementName: "First Blood",
    tournamentName: "Spring Cup",
    friendUsername: "buddy",
  }),
});

// ---------------------------------------------------------------------------
// Property 11: Activity feed is in reverse chronological order
// ---------------------------------------------------------------------------

describe("ActivityFeed — Property 11: reverse chronological order", () => {
  it("renders activity events in non-increasing timestamp order for any input", () => {
    fc.assert(
      fc.property(
        fc.array(activityArb, { minLength: 1, maxLength: 20 }),
        (activities) => {
          const { unmount } = render(<ActivityFeed activities={activities} />);

          const timestampEls = screen.queryAllByTestId("activity-timestamp");
          const timestamps = timestampEls.map((el) => el.getAttribute("data-ts") as string);

          // Verify the sequence is non-increasing (each ts >= next ts)
          let passed = true;
          for (let i = 1; i < timestamps.length; i++) {
            if (new Date(timestamps[i]).getTime() > new Date(timestamps[i - 1]).getTime()) {
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
