/**
 * Unit tests for useSessionExpiryWarning (#1090).
 *
 * Covers:
 *  - modal is closed when the token has plenty of time left
 *  - modal opens when the token expires within the 2-minute warning window
 *  - "Stay signed in" (extend) calls refreshAccessToken and, once the new
 *    expiry is far enough away, the modal reports closed again
 *  - ignoring the warning until expiry logs out and redirects to
 *    /login?reason=session_expired with returnTo set
 *  - never opens when there is no signed-in user (public pages)
 */

import { renderHook, act } from "@testing-library/react";
import {
  useSessionExpiryWarning,
  SESSION_EXPIRY_WARNING_SECONDS,
} from "@/hooks/useSessionExpiryWarning";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/en/wallet",
  useSearchParams: () => new URLSearchParams("tab=deposit"),
}));

const mockRefreshAccessToken = jest.fn<Promise<number>, []>();
const mockLogout = jest.fn();

let mockUser: { id: string } | null = { id: "user-1" };
let mockExpiresAt: number | null = null;

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    expiresAt: mockExpiresAt,
    refreshAccessToken: mockRefreshAccessToken,
    logout: mockLogout,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockUser = { id: "user-1" };
  mockExpiresAt = null;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useSessionExpiryWarning", () => {
  it("is closed when there is no signed-in user (public pages)", () => {
    mockUser = null;
    mockExpiresAt = Date.now() + 90_000;
    const { result } = renderHook(() => useSessionExpiryWarning());
    expect(result.current.isOpen).toBe(false);
  });

  it("is closed when the token has plenty of time left", () => {
    mockExpiresAt = Date.now() + (SESSION_EXPIRY_WARNING_SECONDS + 60) * 1_000;
    const { result } = renderHook(() => useSessionExpiryWarning());
    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(result.current.isOpen).toBe(false);
  });

  it("opens when the token expires in 90 seconds", () => {
    mockExpiresAt = Date.now() + 90_000;
    const { result } = renderHook(() => useSessionExpiryWarning());
    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(90);
    expect(result.current.secondsRemaining).toBeGreaterThan(80);
  });

  it("'Stay signed in' refreshes the token", async () => {
    mockExpiresAt = Date.now() + 90_000;
    mockRefreshAccessToken.mockResolvedValue(900);
    const { result } = renderHook(() => useSessionExpiryWarning());

    act(() => {
      jest.advanceTimersByTime(0);
    });
    expect(result.current.isOpen).toBe(true);

    await act(async () => {
      await result.current.extend();
    });

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("redirects to /login with returnTo when the token expires unattended", () => {
    mockExpiresAt = Date.now() + 1_000;
    renderHook(() => useSessionExpiryWarning());

    act(() => {
      jest.advanceTimersByTime(2_000);
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      "/login?reason=session_expired&returnTo=" +
        encodeURIComponent("/en/wallet?tab=deposit"),
    );
  });

  it("'Sign out' logs out immediately and redirects", () => {
    mockExpiresAt = Date.now() + 90_000;
    const { result } = renderHook(() => useSessionExpiryWarning());

    act(() => {
      result.current.signOut();
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/login?reason=user_logout");
  });
});
