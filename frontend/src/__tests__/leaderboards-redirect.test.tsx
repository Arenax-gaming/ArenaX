/**
 * Unit tests for the /leaderboards -> /leaderboard redirect (#1085).
 */

import LeaderboardsRedirectPage from "@/app/[locale]/leaderboards/page";

const mockRedirect = jest.fn();
jest.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

beforeEach(() => {
  mockRedirect.mockClear();
});

describe("/leaderboards redirect page", () => {
  it("redirects to the locale-prefixed canonical /leaderboard route", () => {
    LeaderboardsRedirectPage({ params: { locale: "en" }, searchParams: {} });
    expect(mockRedirect).toHaveBeenCalledWith("/en/leaderboard");
  });

  it("preserves query params (e.g. a deep-linked season) on redirect", () => {
    LeaderboardsRedirectPage({
      params: { locale: "fr" },
      searchParams: { season: "2025-summer" },
    });
    expect(mockRedirect).toHaveBeenCalledWith("/fr/leaderboard?season=2025-summer");
  });

  it("takes the first value when a query param is provided as an array", () => {
    LeaderboardsRedirectPage({
      params: { locale: "en" },
      searchParams: { season: ["2025", "2024"] },
    });
    expect(mockRedirect).toHaveBeenCalledWith("/en/leaderboard?season=2025");
  });
});
