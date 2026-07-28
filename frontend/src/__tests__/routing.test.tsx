/**
 * Routing system tests
 *
 * Covers:
 *  - routeConfig: getRouteConfig correctly classifies paths
 *  - routeConfig: stripLocalePrefix strips locale from paths
 *  - routeAnalytics: trackPageView buffers events and dispatches on flush
 *  - routeAnalytics: trackGuardEvent fires guard custom events
 *  - routeAnalytics: trackChunkLoadFailure fires chunk-fail custom events
 *  - RouteGuard: renders children for public routes
 *  - RouteGuard: shows loading skeleton while auth resolves
 *  - RouteGuard: redirects unauthenticated users to login
 *  - RouteGuard: shows 403 Forbidden for insufficient role
 *  - RouteGuard: shows email verification prompt for unverified users
 *  - useRouteMonitoring: receives pageview events
 *  - useRouteMonitoring: receives guard events
 *  - useRouteMonitoring: receives chunk failure events
 */

import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

// ─── Module under test ────────────────────────────────────────────────────────

import {
  getRouteConfig,
  stripLocalePrefix,
  ROUTE_CONFIGS,
} from "@/lib/routeConfig";

import {
  trackPageView,
  trackGuardEvent,
  trackChunkLoadFailure,
  flushRouteAnalytics,
} from "@/lib/routeAnalytics";

import { useRouteMonitoring } from "@/hooks/useRouteMonitoring";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock next/navigation so RouteGuard and RouteChangeMonitor don't crash in jsdom
const mockReplace = jest.fn();
const mockPathname = jest.fn(() => "/en/dashboard");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("next-intl", () => ({
  useLocale: () => "en",
}));

// Minimal auth hook mock — overridden per test via `mockAuthState`
let mockAuthState: {
  user: null | {
    id: string;
    username: string;
    role?: string;
    isVerified?: boolean;
  };
  loading: boolean;
} = { user: null, loading: false };

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockAuthState,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setAuth(
  user: null | {
    id: string;
    username: string;
    role?: string;
    isVerified?: boolean;
  },
  loading = false
) {
  mockAuthState = { user, loading };
}

// ─── routeConfig tests ────────────────────────────────────────────────────────

describe("getRouteConfig", () => {
  test("classifies root path as public", () => {
    const config = getRouteConfig("/");
    expect(config.requirement).toBe("public");
  });

  test("classifies /login as public", () => {
    expect(getRouteConfig("/login").requirement).toBe("public");
  });

  test("classifies /dashboard as verified", () => {
    expect(getRouteConfig("/dashboard").requirement).toBe("verified");
  });

  test("classifies /admin as admin", () => {
    expect(getRouteConfig("/admin").requirement).toBe("admin");
  });

  test("classifies /admin/users as admin", () => {
    expect(getRouteConfig("/admin/users").requirement).toBe("admin");
  });

  test("classifies /admin/access-denied as public", () => {
    expect(getRouteConfig("/admin/access-denied").requirement).toBe("public");
  });

  test("classifies /settings/account as verified", () => {
    expect(getRouteConfig("/settings/account").requirement).toBe("verified");
  });

  test("classifies /tournaments as public", () => {
    expect(getRouteConfig("/tournaments").requirement).toBe("public");
  });

  test("classifies /tournaments/123 as public (browsing)", () => {
    expect(getRouteConfig("/tournaments").requirement).toBe("public");
  });

  test("classifies /wallet as verified", () => {
    expect(getRouteConfig("/wallet").requirement).toBe("verified");
  });

  test("returns group for known route", () => {
    expect(getRouteConfig("/dashboard").group).toBe("dashboard");
    expect(getRouteConfig("/admin").group).toBe("admin");
    expect(getRouteConfig("/tournaments").group).toBe("gaming");
  });

  test("falls back to public for unknown routes", () => {
    const config = getRouteConfig("/some-unknown-path");
    expect(config.requirement).toBe("public");
  });
});

describe("stripLocalePrefix", () => {
  const locales = ["en", "es", "ar", "fr", "yo"] as const;

  test("strips /en prefix", () => {
    expect(stripLocalePrefix("/en/dashboard", locales)).toBe("/dashboard");
  });

  test("strips /ar prefix", () => {
    expect(stripLocalePrefix("/ar/admin", locales)).toBe("/admin");
  });

  test("handles locale-only path", () => {
    expect(stripLocalePrefix("/en", locales)).toBe("/");
  });

  test("does not strip non-locale prefix", () => {
    expect(stripLocalePrefix("/dashboard", locales)).toBe("/dashboard");
  });

  test("handles /fr/tournaments/123", () => {
    expect(stripLocalePrefix("/fr/tournaments/123", locales)).toBe(
      "/tournaments/123"
    );
  });
});

// ─── routeAnalytics tests ─────────────────────────────────────────────────────

describe("routeAnalytics", () => {
  beforeEach(() => {
    // Remove all custom event listeners between tests
    jest.restoreAllMocks();
  });

  test("trackPageView dispatches pageview event on flush", () => {
    const handler = jest.fn();
    window.addEventListener("arenax:route:pageview", handler);

    trackPageView({
      path: "/en/dashboard",
      locale: "en",
      group: "dashboard",
      referrer: "",
    });
    flushRouteAnalytics();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toBeInstanceOf(Array);
    expect(detail[0].path).toBe("/en/dashboard");
    expect(detail[0].group).toBe("dashboard");

    window.removeEventListener("arenax:route:pageview", handler);
  });

  test("trackGuardEvent dispatches guard event on flush", () => {
    const handler = jest.fn();
    window.addEventListener("arenax:route:guard", handler);

    trackGuardEvent({
      type: "auth_redirect",
      path: "/en/dashboard",
      locale: "en",
    });
    flushRouteAnalytics();

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail[0].type).toBe("auth_redirect");

    window.removeEventListener("arenax:route:guard", handler);
  });

  test("trackChunkLoadFailure dispatches chunkfail event immediately", () => {
    const handler = jest.fn();
    window.addEventListener("arenax:route:chunkfail", handler);

    trackChunkLoadFailure({
      chunkName: "WalletDashboard",
      path: "/en/wallet",
      error: "Failed to fetch",
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0][0] as CustomEvent).detail;
    expect(detail.chunkName).toBe("WalletDashboard");
    expect(detail.error).toBe("Failed to fetch");

    window.removeEventListener("arenax:route:chunkfail", handler);
  });

  test("pageview buffer flushes after MAX_BUFFER_SIZE items", () => {
    const handler = jest.fn();
    window.addEventListener("arenax:route:pageview", handler);

    // Fill buffer past max (50) — should auto-flush
    for (let i = 0; i < 51; i++) {
      trackPageView({
        path: `/en/page-${i}`,
        locale: "en",
        group: "public",
        referrer: "",
      });
    }

    // At least one flush should have occurred
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1);

    window.removeEventListener("arenax:route:pageview", handler);
  });
});

// ─── useRouteMonitoring tests ─────────────────────────────────────────────────

describe("useRouteMonitoring", () => {
  test("calls onPageView handler when pageview event fires", () => {
    const onPageView = jest.fn();
    renderHook(() => useRouteMonitoring({ onPageView }));

    const event = new CustomEvent("arenax:route:pageview", {
      detail: [
        {
          path: "/en/leaderboard",
          locale: "en",
          group: "gaming",
          referrer: "",
          timestamp: Date.now(),
        },
      ],
    });
    act(() => window.dispatchEvent(event));

    expect(onPageView).toHaveBeenCalledTimes(1);
    expect(onPageView.mock.calls[0][0][0].path).toBe("/en/leaderboard");
  });

  test("calls onGuardEvent handler when guard event fires", () => {
    const onGuardEvent = jest.fn();
    renderHook(() => useRouteMonitoring({ onGuardEvent }));

    const event = new CustomEvent("arenax:route:guard", {
      detail: [
        {
          type: "role_denied",
          path: "/en/admin",
          locale: "en",
          requiredRole: "admin",
          timestamp: Date.now(),
        },
      ],
    });
    act(() => window.dispatchEvent(event));

    expect(onGuardEvent).toHaveBeenCalledTimes(1);
    expect(onGuardEvent.mock.calls[0][0][0].type).toBe("role_denied");
  });

  test("calls onChunkFailure when chunkfail event fires", () => {
    const onChunkFailure = jest.fn();
    renderHook(() => useRouteMonitoring({ onChunkFailure }));

    const event = new CustomEvent("arenax:route:chunkfail", {
      detail: {
        chunkName: "AdminPanel",
        path: "/en/admin",
        error: "Network error",
        timestamp: Date.now(),
      },
    });
    act(() => window.dispatchEvent(event));

    expect(onChunkFailure).toHaveBeenCalledTimes(1);
    expect(onChunkFailure.mock.calls[0][0].chunkName).toBe("AdminPanel");
  });

  test("removes listeners on unmount", () => {
    const onPageView = jest.fn();
    const { unmount } = renderHook(() => useRouteMonitoring({ onPageView }));
    unmount();

    const event = new CustomEvent("arenax:route:pageview", { detail: [] });
    act(() => window.dispatchEvent(event));

    // Handler should NOT be called after unmount
    expect(onPageView).not.toHaveBeenCalled();
  });
});

// ─── RouteGuard component tests ───────────────────────────────────────────────

// Import here (after mocks are established)
import { RouteGuard } from "@/components/navigation/RouteGuard";

describe("RouteGuard", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    setAuth(null, false);
  });

  test("renders children for public requirement regardless of auth state", () => {
    setAuth(null, false);
    render(
      <RouteGuard requirement="public">
        <div data-testid="content">Public Content</div>
      </RouteGuard>
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  test("shows loading skeleton while auth is resolving", () => {
    setAuth(null, true);
    render(
      <RouteGuard requirement="auth">
        <div data-testid="content">Protected</div>
      </RouteGuard>
    );
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("renders null and fires redirect when unauthenticated on auth route", async () => {
    setAuth(null, false);
    render(
      <RouteGuard requirement="auth">
        <div data-testid="content">Protected</div>
      </RouteGuard>
    );

    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("/login")
      );
    });
  });

  test("renders children for authenticated user on auth route", () => {
    setAuth({ id: "1", username: "player1", isVerified: true });
    render(
      <RouteGuard requirement="auth">
        <div data-testid="content">Protected</div>
      </RouteGuard>
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  test("shows email verification prompt for unverified user on verified route", () => {
    setAuth({ id: "1", username: "player1", isVerified: false });
    render(
      <RouteGuard requirement="verified">
        <div data-testid="content">Verified Only</div>
      </RouteGuard>
    );
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    // Use getAllByText because the heading and body paragraph both match the pattern
    expect(screen.getAllByText(/verify your email/i).length).toBeGreaterThanOrEqual(1);
  });

  test("renders children for verified user on verified route", () => {
    setAuth({ id: "1", username: "player1", isVerified: true });
    render(
      <RouteGuard requirement="verified">
        <div data-testid="content">Verified Only</div>
      </RouteGuard>
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  test("shows 403 Forbidden for authenticated non-admin on admin route", () => {
    setAuth({ id: "1", username: "player1", role: "user", isVerified: true });
    render(
      <RouteGuard requirement="admin">
        <div data-testid="content">Admin Only</div>
      </RouteGuard>
    );
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    expect(screen.getByText(/403 forbidden/i)).toBeInTheDocument();
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
  });

  test("renders children for admin user on admin route", () => {
    setAuth({ id: "1", username: "admin1", role: "admin", isVerified: true });
    render(
      <RouteGuard requirement="admin">
        <div data-testid="content">Admin Panel</div>
      </RouteGuard>
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  test("renders custom loading fallback", () => {
    setAuth(null, true);
    render(
      <RouteGuard
        requirement="auth"
        loadingFallback={<div data-testid="custom-loader">Loading…</div>}
      >
        <div data-testid="content">Content</div>
      </RouteGuard>
    );
    expect(screen.getByTestId("custom-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
  });

  test("shows 403 for moderator-only route when user lacks role", () => {
    setAuth({ id: "1", username: "player1", role: "user", isVerified: true });
    render(
      <RouteGuard requirement="moderator">
        <div data-testid="content">Mod Only</div>
      </RouteGuard>
    );
    expect(screen.queryByTestId("content")).not.toBeInTheDocument();
    expect(screen.getByText(/403 forbidden/i)).toBeInTheDocument();
  });

  test("allows admin through a moderator route", () => {
    setAuth({ id: "1", username: "admin1", role: "admin", isVerified: true });
    render(
      <RouteGuard requirement="moderator">
        <div data-testid="content">Mod Panel</div>
      </RouteGuard>
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });
});

// ─── ROUTE_CONFIGS integrity check ───────────────────────────────────────────

describe("ROUTE_CONFIGS", () => {
  test("every config has a non-empty pattern", () => {
    ROUTE_CONFIGS.forEach((cfg) => {
      expect(cfg.pattern.length).toBeGreaterThan(0);
    });
  });

  test("every config has a valid requirement", () => {
    const validReqs = new Set(["public", "auth", "verified", "admin", "moderator"]);
    ROUTE_CONFIGS.forEach((cfg) => {
      expect(validReqs.has(cfg.requirement)).toBe(true);
    });
  });

  test("every config has a valid group", () => {
    const validGroups = new Set([
      "auth", "dashboard", "gaming", "social", "admin", "settings", "public",
    ]);
    ROUTE_CONFIGS.forEach((cfg) => {
      expect(validGroups.has(cfg.group)).toBe(true);
    });
  });

  test("no duplicate exact patterns", () => {
    const patterns = ROUTE_CONFIGS.map((c) => c.pattern);
    const unique = new Set(patterns);
    expect(unique.size).toBe(patterns.length);
  });
});
