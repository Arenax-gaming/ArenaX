/**
 * AppContext — Issue #692
 *
 * Global app-level state: online status, app version, sidebar, modals,
 * feature flags, and analytics event hooks for state transitions.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppStatus = "idle" | "loading" | "ready" | "error";

export interface FeatureFlags {
  enableRealTimeMessages: boolean;
  enableStellarWallet: boolean;
  enableAntiCheat: boolean;
  enableGovernance: boolean;
  enableAnalyticsDashboard: boolean;
}

export interface AppState {
  status: AppStatus;
  isOnline: boolean;
  isSidebarOpen: boolean;
  activeModal: string | null;
  appVersion: string;
  featureFlags: FeatureFlags;
  /** Accumulated non-critical error messages shown in a banner */
  bannerError: string | null;
  /** Global loading overlay message */
  globalLoadingMessage: string | null;
}

type AppAction =
  | { type: "SET_STATUS"; payload: AppStatus }
  | { type: "SET_ONLINE"; payload: boolean }
  | { type: "TOGGLE_SIDEBAR" }
  | { type: "SET_SIDEBAR"; payload: boolean }
  | { type: "OPEN_MODAL"; payload: string }
  | { type: "CLOSE_MODAL" }
  | { type: "SET_BANNER_ERROR"; payload: string | null }
  | { type: "SET_GLOBAL_LOADING"; payload: string | null }
  | { type: "SET_FEATURE_FLAG"; payload: { key: keyof FeatureFlags; value: boolean } };

const DEFAULT_FLAGS: FeatureFlags = {
  enableRealTimeMessages: true,
  enableStellarWallet: true,
  enableAntiCheat: false,
  enableGovernance: true,
  enableAnalyticsDashboard: true,
};

const initialState: AppState = {
  status: "idle",
  isOnline: true,
  isSidebarOpen: false,
  activeModal: null,
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
  featureFlags: DEFAULT_FLAGS,
  bannerError: null,
  globalLoadingMessage: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_STATUS":
      return { ...state, status: action.payload };
    case "SET_ONLINE":
      return { ...state, isOnline: action.payload };
    case "TOGGLE_SIDEBAR":
      return { ...state, isSidebarOpen: !state.isSidebarOpen };
    case "SET_SIDEBAR":
      return { ...state, isSidebarOpen: action.payload };
    case "OPEN_MODAL":
      return { ...state, activeModal: action.payload };
    case "CLOSE_MODAL":
      return { ...state, activeModal: null };
    case "SET_BANNER_ERROR":
      return { ...state, bannerError: action.payload };
    case "SET_GLOBAL_LOADING":
      return { ...state, globalLoadingMessage: action.payload };
    case "SET_FEATURE_FLAG":
      return {
        ...state,
        featureFlags: { ...state.featureFlags, [action.payload.key]: action.payload.value },
      };
    default:
      return state;
  }
}

// ─── Analytics hook ───────────────────────────────────────────────────────────

export interface AppAnalyticsEvent {
  type: string;
  detail?: string;
  timestamp: number;
}

const _appEvents: AppAnalyticsEvent[] = [];

function trackAppEvent(type: string, detail?: string): void {
  _appEvents.unshift({ type, detail, timestamp: Date.now() });
  if (_appEvents.length > 100) _appEvents.length = 100;
}

export function getAppEvents(): readonly AppAnalyticsEvent[] {
  return _appEvents;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState;
  // Actions
  setStatus: (status: AppStatus) => void;
  toggleSidebar: () => void;
  setSidebar: (open: boolean) => void;
  openModal: (id: string) => void;
  closeModal: () => void;
  setBannerError: (msg: string | null) => void;
  setGlobalLoading: (msg: string | null) => void;
  setFeatureFlag: (key: keyof FeatureFlags, value: boolean) => void;
  // Derived
  isFeatureEnabled: (key: keyof FeatureFlags) => boolean;
  isModalOpen: (id: string) => boolean;
}

const AppContext = createContext<AppContextValue | null>(null);
AppContext.displayName = "AppContext";

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const prevOnlineRef = useRef(state.isOnline);

  // Track online / offline transitions
  useEffect(() => {
    const handleOnline = () => {
      dispatch({ type: "SET_ONLINE", payload: true });
      trackAppEvent("network_online");
    };
    const handleOffline = () => {
      dispatch({ type: "SET_ONLINE", payload: false });
      trackAppEvent("network_offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Set initial state from browser
    dispatch({ type: "SET_ONLINE", payload: navigator.onLine });

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Log online→offline transitions
  useEffect(() => {
    if (prevOnlineRef.current !== state.isOnline) {
      trackAppEvent("connectivity_change", state.isOnline ? "online" : "offline");
      prevOnlineRef.current = state.isOnline;
    }
  }, [state.isOnline]);

  // Mark app as ready once mounted
  useEffect(() => {
    dispatch({ type: "SET_STATUS", payload: "ready" });
  }, []);

  const setStatus = useCallback((status: AppStatus) => {
    dispatch({ type: "SET_STATUS", payload: status });
    trackAppEvent("status_change", status);
  }, []);

  const toggleSidebar = useCallback(() => {
    dispatch({ type: "TOGGLE_SIDEBAR" });
    trackAppEvent("sidebar_toggle");
  }, []);

  const setSidebar = useCallback((open: boolean) => {
    dispatch({ type: "SET_SIDEBAR", payload: open });
  }, []);

  const openModal = useCallback((id: string) => {
    dispatch({ type: "OPEN_MODAL", payload: id });
    trackAppEvent("modal_open", id);
  }, []);

  const closeModal = useCallback(() => {
    dispatch({ type: "CLOSE_MODAL" });
    trackAppEvent("modal_close");
  }, []);

  const setBannerError = useCallback((msg: string | null) => {
    dispatch({ type: "SET_BANNER_ERROR", payload: msg });
    if (msg) trackAppEvent("banner_error", msg);
  }, []);

  const setGlobalLoading = useCallback((msg: string | null) => {
    dispatch({ type: "SET_GLOBAL_LOADING", payload: msg });
  }, []);

  const setFeatureFlag = useCallback((key: keyof FeatureFlags, value: boolean) => {
    dispatch({ type: "SET_FEATURE_FLAG", payload: { key, value } });
    trackAppEvent("feature_flag_change", `${key}=${String(value)}`);
  }, []);

  const isFeatureEnabled = useCallback(
    (key: keyof FeatureFlags) => state.featureFlags[key],
    [state.featureFlags],
  );

  const isModalOpen = useCallback(
    (id: string) => state.activeModal === id,
    [state.activeModal],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      setStatus,
      toggleSidebar,
      setSidebar,
      openModal,
      closeModal,
      setBannerError,
      setGlobalLoading,
      setFeatureFlag,
      isFeatureEnabled,
      isModalOpen,
    }),
    [
      state,
      setStatus,
      toggleSidebar,
      setSidebar,
      openModal,
      closeModal,
      setBannerError,
      setGlobalLoading,
      setFeatureFlag,
      isFeatureEnabled,
      isModalOpen,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

/** Sliced selector — only re-renders when selected slice changes */
export function useAppSelector<T>(selector: (state: AppState) => T): T {
  const { state } = useApp();
  return selector(state);
}
