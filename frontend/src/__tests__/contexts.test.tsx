/**
 * Tests for Global State Contexts — Issue #692
 * Covers: AppContext, ThemeContext, UserPreferencesContext
 */

import React from "react";
import { render, screen, act, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";

// ─── AppContext ────────────────────────────────────────────────────────────────

describe("AppContext", () => {
  let AppProvider: React.FC<{ children: React.ReactNode }>;
  let useApp: () => ReturnType<typeof import("@/contexts/AppContext").useApp>;

  beforeEach(async () => {
    const mod = await import("@/contexts/AppContext");
    AppProvider = mod.AppProvider;
    useApp = mod.useApp;
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(AppProvider, null, children);
  }

  it("provides initial state", () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    expect(result.current.state.status).toBe("ready");
    expect(result.current.state.isSidebarOpen).toBe(false);
    expect(result.current.state.activeModal).toBeNull();
    expect(result.current.state.bannerError).toBeNull();
  });

  it("toggleSidebar flips isSidebarOpen", () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    expect(result.current.state.isSidebarOpen).toBe(false);
    act(() => result.current.toggleSidebar());
    expect(result.current.state.isSidebarOpen).toBe(true);
    act(() => result.current.toggleSidebar());
    expect(result.current.state.isSidebarOpen).toBe(false);
  });

  it("openModal / closeModal manage activeModal", () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.openModal("deposit"));
    expect(result.current.state.activeModal).toBe("deposit");
    expect(result.current.isModalOpen("deposit")).toBe(true);
    act(() => result.current.closeModal());
    expect(result.current.state.activeModal).toBeNull();
    expect(result.current.isModalOpen("deposit")).toBe(false);
  });

  it("setBannerError sets and clears error", () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.setBannerError("Something went wrong"));
    expect(result.current.state.bannerError).toBe("Something went wrong");
    act(() => result.current.setBannerError(null));
    expect(result.current.state.bannerError).toBeNull();
  });

  it("setFeatureFlag updates feature flags", () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.setFeatureFlag("enableAntiCheat", true));
    expect(result.current.isFeatureEnabled("enableAntiCheat")).toBe(true);
  });

  it("setGlobalLoading sets and clears loading message", () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.setGlobalLoading("Processing…"));
    expect(result.current.state.globalLoadingMessage).toBe("Processing…");
    act(() => result.current.setGlobalLoading(null));
    expect(result.current.state.globalLoadingMessage).toBeNull();
  });

  it("useApp throws when used outside AppProvider", () => {
    // Suppress the expected error output
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useApp())).toThrow(
      "useApp must be used inside <AppProvider>",
    );
    spy.mockRestore();
  });

  it("setSidebar directly sets sidebar state", () => {
    const { result } = renderHook(() => useApp(), { wrapper });
    act(() => result.current.setSidebar(true));
    expect(result.current.state.isSidebarOpen).toBe(true);
    act(() => result.current.setSidebar(false));
    expect(result.current.state.isSidebarOpen).toBe(false);
  });
});

// ─── UserPreferencesContext ───────────────────────────────────────────────────

describe("UserPreferencesContext", () => {
  let UserPreferencesProvider: React.FC<{ children: React.ReactNode }>;
  let useUserPreferences: () => ReturnType<typeof import("@/contexts/UserPreferencesContext").useUserPreferences>;

  beforeEach(async () => {
    localStorage.clear();
    const mod = await import("@/contexts/UserPreferencesContext");
    UserPreferencesProvider = mod.UserPreferencesProvider;
    useUserPreferences = mod.useUserPreferences;
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(UserPreferencesProvider, null, children);
  }

  it("provides default preferences", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => {
      expect(result.current.prefs.locale).toBe("en");
      expect(result.current.prefs.currency).toBe("NGN");
      expect(result.current.prefs.game.preferredGameMode).toBe("ranked");
    });
  });

  it("setLocale updates locale", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.locale).toBe("en"));
    act(() => result.current.setLocale("fr"));
    expect(result.current.prefs.locale).toBe("fr");
  });

  it("setNotificationPref toggles a notification preference", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.notifications.matchUpdates).toBe(true));
    act(() => result.current.setNotificationPref("matchUpdates", false));
    expect(result.current.prefs.notifications.matchUpdates).toBe(false);
  });

  it("setPrivacyPref toggles a privacy preference", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.privacy.showOnlineStatus).toBe(true));
    act(() => result.current.setPrivacyPref("showOnlineStatus", false));
    expect(result.current.prefs.privacy.showOnlineStatus).toBe(false);
  });

  it("setGamePref updates game preferences", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.game.preferredGameMode).toBe("ranked"));
    act(() => result.current.setGamePref({ preferredGameMode: "casual" }));
    expect(result.current.prefs.game.preferredGameMode).toBe("casual");
  });

  it("setAccessibilityPref toggles accessibility preference", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.accessibility.reducedMotion).toBe(false));
    act(() => result.current.setAccessibilityPref("reducedMotion", true));
    expect(result.current.prefs.accessibility.reducedMotion).toBe(true);
  });

  it("resetPreferences restores defaults", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.locale).toBe("en"));
    act(() => result.current.setLocale("de"));
    expect(result.current.prefs.locale).toBe("de");
    act(() => result.current.resetPreferences());
    expect(result.current.prefs.locale).toBe("en");
  });

  it("exportPreferences returns valid JSON", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.locale).toBe("en"));
    const exported = result.current.exportPreferences();
    expect(() => JSON.parse(exported)).not.toThrow();
    const parsed = JSON.parse(exported) as { version: number; data: { locale: string } };
    expect(parsed.version).toBe(1);
    expect(parsed.data.locale).toBe("en");
  });

  it("importPreferences applies imported prefs", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.locale).toBe("en"));

    const toImport = JSON.stringify({ version: 1, data: { locale: "pt", currency: "BRL" } });
    let success = false;
    act(() => { success = result.current.importPreferences(toImport); });

    expect(success).toBe(true);
    expect(result.current.prefs.locale).toBe("pt");
    expect(result.current.prefs.currency).toBe("BRL");
  });

  it("importPreferences returns false on invalid JSON", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.locale).toBe("en"));

    let success = true;
    act(() => { success = result.current.importPreferences("not-json"); });
    expect(success).toBe(false);
  });

  it("useUserPreferences throws when used outside provider", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useUserPreferences())).toThrow(
      "useUserPreferences must be used inside <UserPreferencesProvider>",
    );
    spy.mockRestore();
  });

  it("persists preferences to localStorage", async () => {
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.prefs.locale).toBe("en"));
    act(() => result.current.setLocale("jp"));

    await waitFor(() => {
      const stored = localStorage.getItem("arenax_user_preferences");
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!) as { data: { locale: string } };
      expect(parsed.data.locale).toBe("jp");
    });
  });
});

// ─── ThemeContext ──────────────────────────────────────────────────────────────

describe("ThemeContext", () => {
  it("useTheme throws when used outside ThemeContextProvider", async () => {
    const { useTheme } = await import("@/contexts/ThemeContext");
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow(
      "useThemeContext must be used inside <ThemeContextProvider>",
    );
    spy.mockRestore();
  });
});

// ─── Rendering integration ────────────────────────────────────────────────────

describe("Context rendering", () => {
  it("AppProvider renders children without crashing", async () => {
    const { AppProvider } = await import("@/contexts/AppContext");
    render(
      React.createElement(AppProvider, null,
        React.createElement("div", { "data-testid": "child" }, "Hello")
      )
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("UserPreferencesProvider renders children without crashing", async () => {
    const { UserPreferencesProvider } = await import("@/contexts/UserPreferencesContext");
    render(
      React.createElement(UserPreferencesProvider, null,
        React.createElement("div", { "data-testid": "child" }, "Hello")
      )
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
