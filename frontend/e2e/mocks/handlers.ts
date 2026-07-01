import { Page } from "@playwright/test";

const BASE = "**/api";

export const mockUser = {
  id: "user-1",
  username: "testuser",
  email: "test@example.com",
  emailVerified: true,
};

export const mockTokens = {
  accessToken: "mock-access-token",
  refreshToken: "mock-refresh-token",
};

export const mockTournament = {
  id: "tournament-1",
  name: "Weekend Warriors Cup",
  game: "FIFA 24",
  status: "upcoming",
  entryFee: 500,
  prizePool: 10000,
  maxParticipants: 32,
  currentParticipants: 12,
  startDate: new Date(Date.now() + 86400000).toISOString(),
};

export const mockMatch = {
  id: "match-1",
  tournamentId: "tournament-1",
  status: "pending",
  player1: { id: "user-1", username: "testuser" },
  player2: { id: "user-2", username: "opponent" },
};

export async function mockAuthHandlers(page: Page) {
  await page.route(`${BASE}/auth/register`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: mockUser, tokens: mockTokens }),
    })
  );

  await page.route(`${BASE}/auth/login`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: mockUser, tokens: mockTokens }),
    })
  );

  await page.route(`${BASE}/auth/verify-email`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "Email verified successfully" }),
    })
  );

  await page.route(`${BASE}/auth/resend-verification-email`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "Verification email sent" }),
    })
  );
}

export async function mockTournamentHandlers(page: Page) {
  await page.route(`${BASE}/tournaments`, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockTournament] }),
      });
    }
    return route.continue();
  });

  await page.route(`${BASE}/tournaments/*`, (route) => {
    const url = route.request().url();
    if (url.endsWith("/register") && route.request().method() === "POST") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { message: "Registered successfully" } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: mockTournament }),
    });
  });
}

export async function mockMatchHandlers(page: Page) {
  await page.route(`${BASE}/matches`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [mockMatch] }),
    })
  );

  await page.route(`${BASE}/matches/*/report`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { message: "Score reported" } }),
    })
  );

  await page.route(`${BASE}/matches/*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { ...mockMatch, status: "active" } }),
    })
  );
}

export async function mockWalletHandlers(page: Page) {
  await page.route(`${BASE}/wallet/**`, (route) => {
    const url = route.request().url();
    if (url.includes("/withdraw")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { txId: "tx-123", status: "pending" } }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          fiatBalance: 5000,
          xlmBalance: 100,
          axBalance: 250,
          stellarPublicKey: "GTEST1234567890",
        },
      }),
    });
  });
}

export async function mockNotificationHandlers(page: Page) {
  await page.route(`${BASE}/notifications**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    })
  );
}
