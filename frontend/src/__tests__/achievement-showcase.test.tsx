/**
 * Feature: player-profile, Property 10: Achievement "New" badge only for recent unlocks
 *
 * For any achievement with unlockedAt more than 30 days ago, the "New" badge should not be shown.
 * For any achievement with unlockedAt within the last 30 days, the "New" badge should be shown.
 * Validates: Requirements 5.4
 */

import React from "react";
import * as fc from "fast-check";
import { render, screen } from "@testing-library/react";
import { AchievementShowcase } from "@/components/profile/AchievementShowcase";
import type { Achievement } from "@/types/profile";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAchievement(overrides: Partial<Achievement>): Achievement {
  return {
    id: "ach-1",
    title: "Test Achievement",
    description: "A test achievement",
    icon: "🏆",
    progress: 10,
    total: 10,
    unlocked: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 10: Achievement "New" badge — only recent unlocks
// ---------------------------------------------------------------------------

describe("AchievementShowcase — Property 10: New badge timing", () => {
  it("does NOT show New badge for achievements unlocked more than 30 days ago", () => {
    fc.assert(
      fc.property(
        // n days beyond 30 (so 31..396 days ago)
        fc.nat({ max: 365 }),
        (n) => {
          const oldDate = new Date(
            Date.now() - (31 + n) * 24 * 60 * 60 * 1000
          ).toISOString();

          const achievement = makeAchievement({ unlockedAt: oldDate });

          const { unmount } = render(
            <AchievementShowcase achievements={[achievement]} />
          );

          const badges = screen.queryAllByTestId("new-badge");
          const result = badges.length === 0;

          unmount();
          return result;
        }
      ),
      { numRuns: 100 }
    );
  });

  it("DOES show New badge for achievements unlocked within the last 30 days", () => {
    fc.assert(
      fc.property(
        // 0..29 days ago
        fc.integer({ min: 0, max: 29 }),
        (n) => {
          const recentDate = new Date(
            Date.now() - n * 24 * 60 * 60 * 1000
          ).toISOString();

          const achievement = makeAchievement({ unlockedAt: recentDate });

          const { unmount } = render(
            <AchievementShowcase achievements={[achievement]} />
          );

          const badges = screen.queryAllByTestId("new-badge");
          const result = badges.length === 1;

          unmount();
          return result;
        }
      ),
      { numRuns: 100 }
    );
  });
});
