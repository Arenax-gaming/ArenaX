/**
 * Unit tests for useNotificationBadge (#1095).
 */

import { renderHook, act } from "@testing-library/react";
import {
  useNotificationBadge,
  stripBadgePrefix,
  withBadgePrefix,
  clearAppBadge,
} from "@/hooks/useNotificationBadge";

let mockUnreadCount = 0;
jest.mock("@/contexts/NotificationContext", () => ({
  useNotifications: () => ({ unreadCount: mockUnreadCount }),
}));

describe("withBadgePrefix / stripBadgePrefix", () => {
  it("prefixes the title with the count when > 0", () => {
    expect(withBadgePrefix("ArenaX — Dashboard", 5)).toBe("(5) ArenaX — Dashboard");
  });

  it("strips an existing prefix before re-applying", () => {
    expect(withBadgePrefix("(3) ArenaX — Dashboard", 5)).toBe("(5) ArenaX — Dashboard");
  });

  it("removes the prefix entirely at zero", () => {
    expect(withBadgePrefix("(5) ArenaX — Dashboard", 0)).toBe("ArenaX — Dashboard");
  });

  it("stripBadgePrefix is a no-op on a title with no prefix", () => {
    expect(stripBadgePrefix("ArenaX — Dashboard")).toBe("ArenaX — Dashboard");
  });
});

describe("useNotificationBadge", () => {
  beforeEach(() => {
    document.title = "ArenaX — Dashboard";
    mockUnreadCount = 0;
  });

  it("sets document.title to include the unread count", () => {
    mockUnreadCount = 5;
    renderHook(() => useNotificationBadge());

    expect(document.title).toContain("(5)");
    expect(document.title).toBe("(5) ArenaX — Dashboard");
  });

  it("removes the badge once the count returns to zero", () => {
    mockUnreadCount = 5;
    const { rerender } = renderHook(() => useNotificationBadge());
    expect(document.title).toBe("(5) ArenaX — Dashboard");

    mockUnreadCount = 0;
    rerender();
    expect(document.title).toBe("ArenaX — Dashboard");
  });

  it("re-applies the badge when something else overwrites document.title", async () => {
    mockUnreadCount = 3;
    renderHook(() => useNotificationBadge());
    expect(document.title).toBe("(3) ArenaX — Dashboard");

    // Simulate Next.js resetting the title on a route change.
    act(() => {
      document.title = "ArenaX — Wallet";
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.title).toBe("(3) ArenaX — Wallet");
  });

  it("calls navigator.setAppBadge with the unread count when supported", () => {
    const setAppBadge = jest.fn().mockResolvedValue(undefined);
    (navigator as unknown as { setAppBadge: typeof setAppBadge }).setAppBadge = setAppBadge;

    mockUnreadCount = 7;
    renderHook(() => useNotificationBadge());

    expect(setAppBadge).toHaveBeenCalledWith(7);
    delete (navigator as { setAppBadge?: unknown }).setAppBadge;
  });

  it("does not throw when the Badging API is unsupported", () => {
    delete (navigator as { setAppBadge?: unknown }).setAppBadge;
    delete (navigator as { clearAppBadge?: unknown }).clearAppBadge;

    mockUnreadCount = 2;
    expect(() => renderHook(() => useNotificationBadge())).not.toThrow();
  });
});

describe("clearAppBadge", () => {
  it("calls navigator.clearAppBadge when supported", () => {
    const clear = jest.fn().mockResolvedValue(undefined);
    (navigator as unknown as { clearAppBadge: typeof clear }).clearAppBadge = clear;

    clearAppBadge();

    expect(clear).toHaveBeenCalledTimes(1);
    delete (navigator as { clearAppBadge?: unknown }).clearAppBadge;
  });

  it("does not throw when unsupported", () => {
    delete (navigator as { clearAppBadge?: unknown }).clearAppBadge;
    expect(() => clearAppBadge()).not.toThrow();
  });
});
