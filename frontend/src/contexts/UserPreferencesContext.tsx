/**
 * UserPreferencesContext — Issue #692
 *
 * Manages user-specific preferences:
 * - Language / locale
 * - Notification settings
 * - Privacy settings
 * - Game preferences (matchmaking, game mode)
 * - Accessibility preferences
 * - Persisted to localStorage with versioned migrations
 * - Analytics hooks for every preference mutation
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationPrefs {
  matchUpdates: boolean;
  tournamentAlerts: boolean;
  friendActivity: boolean;
  systemAnnouncements: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
}

export interface PrivacyPrefs {
  showOnlineStatus: boolean;
  showMatchHistory: boolean;
  showEloRating: boolean;
  allowFriendRequests: boolean;
  showInLeaderboard: boolean;
}

export interface GamePrefs {
  preferredGameMode: string;
  autoAcceptRematches: boolean;
  showScoreConfirmation: boolean;
  enableChatInGame: boolean;
  defaultRegion: string;
}

export interface AccessibilityPrefs {
  highContrast: boolean;
  reducedMotion: boolean;
  largeText: boolean;
  screenReaderOptimised: boolean;
  keyboardNavigationHints: boolean;
}

export interface UserPreferences {
  locale: string;
  currency: string;
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
  game: GamePrefs;
  accessibility: AccessibilityPrefs;
}

// ─── Default preferences ──────────────────────────────────────────────────────

const DEFAULT_PREFS: UserPreferences = {
  locale: "en",
  currency: "NGN",
  notifications: {
    matchUpdates: true,
    tournamentAlerts: true,
    friendActivity: true,
    systemAnnouncements: true,
    emailNotifications: false,
    pushNotifications: false,
  },
  privacy: {
    showOnlineStatus: true,
    showMatchHistory: true,
    showEloRating: true,
    allowFriendRequests: true,
    showInLeaderboard: true,
  },
  game: {
    preferredGameMode: "ranked",
    autoAcceptRematches: false,
    showScoreConfirmation: true,
    enableChatInGame: true,
    defaultRegion: "af-south",
  },
  accessibility: {
    highContrast: false,
    reducedMotion: false,
    largeText: false,
    screenReaderOptimised: false,
    keyboardNavigationHints: true,
  },
};

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "arenax_user_preferences";
const STORAGE_VERSION = 1;

interface PersistedPrefs {
  version: number;
  data: UserPreferences;
}

function loadPrefs(): UserPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as PersistedPrefs;
    if (parsed.version !== STORAGE_VERSION) return DEFAULT_PREFS; // version mismatch → reset
    // Deep-merge with defaults so new keys are always present
    return deepMerge(DEFAULT_PREFS, parsed.data);
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(data: UserPreferences): void {
  if (typeof window === "undefined") return;
  try {
    const toStore: PersistedPrefs = { version: STORAGE_VERSION, data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch { /* quota */ }
}

// Shallow-deep merge: only goes 1 level deep (enough for nested pref objects)
function deepMerge(base: UserPreferences, override: Partial<UserPreferences>): UserPreferences {
  const result = { ...base };
  for (const key of Object.keys(base) as (keyof UserPreferences)[]) {
    const bv = base[key];
    const ov = override[key];
    if (ov !== undefined && typeof bv === "object" && bv !== null && typeof ov === "object") {
      // @ts-expect-error — safe: we know the shapes are compatible nested objects
      result[key] = { ...bv, ...ov };
    } else if (ov !== undefined) {
      // @ts-expect-error — safe: same key, same type
      result[key] = ov;
    }
  }
  return result;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

type PrefsAction =
  | { type: "SET_LOCALE"; payload: string }
  | { type: "SET_CURRENCY"; payload: string }
  | { type: "SET_NOTIFICATION_PREF"; payload: { key: keyof NotificationPrefs; value: boolean } }
  | { type: "SET_PRIVACY_PREF"; payload: { key: keyof PrivacyPrefs; value: boolean } }
  | { type: "SET_GAME_PREF"; payload: Partial<GamePrefs> }
  | { type: "SET_ACCESSIBILITY_PREF"; payload: { key: keyof AccessibilityPrefs; value: boolean } }
  | { type: "RESET" }
  | { type: "HYDRATE"; payload: UserPreferences };

function prefsReducer(state: UserPreferences, action: PrefsAction): UserPreferences {
  switch (action.type) {
    case "SET_LOCALE":
      return { ...state, locale: action.payload };
    case "SET_CURRENCY":
      return { ...state, currency: action.payload };
    case "SET_NOTIFICATION_PREF":
      return {
        ...state,
        notifications: { ...state.notifications, [action.payload.key]: action.payload.value },
      };
    case "SET_PRIVACY_PREF":
      return {
        ...state,
        privacy: { ...state.privacy, [action.payload.key]: action.payload.value },
      };
    case "SET_GAME_PREF":
      return { ...state, game: { ...state.game, ...action.payload } };
    case "SET_ACCESSIBILITY_PREF":
      return {
        ...state,
        accessibility: { ...state.accessibility, [action.payload.key]: action.payload.value },
      };
    case "RESET":
      return DEFAULT_PREFS;
    case "HYDRATE":
      return action.payload;
    default:
      return state;
  }
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface PrefMutationEvent {
  action: string;
  detail?: string;
  timestamp: number;
}

const _prefEvents: PrefMutationEvent[] = [];

function trackPrefEvent(action: string, detail?: string): void {
  _prefEvents.unshift({ action, detail, timestamp: Date.now() });
  if (_prefEvents.length > 100) _prefEvents.length = 100;
}

export function getPrefEvents(): readonly PrefMutationEvent[] {
  return _prefEvents;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface UserPreferencesContextValue {
  prefs: UserPreferences;
  // Actions
  setLocale: (locale: string) => void;
  setCurrency: (currency: string) => void;
  setNotificationPref: (key: keyof NotificationPrefs, value: boolean) => void;
  setPrivacyPref: (key: keyof PrivacyPrefs, value: boolean) => void;
  setGamePref: (updates: Partial<GamePrefs>) => void;
  setAccessibilityPref: (key: keyof AccessibilityPrefs, value: boolean) => void;
  resetPreferences: () => void;
  exportPreferences: () => string;
  importPreferences: (json: string) => boolean;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);
UserPreferencesContext.displayName = "UserPreferencesContext";

// ─── Provider ─────────────────────────────────────────────────────────────────

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, dispatch] = useReducer(prefsReducer, DEFAULT_PREFS);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    const stored = loadPrefs();
    dispatch({ type: "HYDRATE", payload: stored });
  }, []);

  // Persist to localStorage on every change
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  // Apply reduced-motion preference to document
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("reduce-motion", prefs.accessibility.reducedMotion);
  }, [prefs.accessibility.reducedMotion]);

  // Apply high-contrast preference to document
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("high-contrast", prefs.accessibility.highContrast);
  }, [prefs.accessibility.highContrast]);

  // Apply large-text preference
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.classList.toggle("large-text", prefs.accessibility.largeText);
  }, [prefs.accessibility.largeText]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const setLocale = useCallback((locale: string) => {
    dispatch({ type: "SET_LOCALE", payload: locale });
    trackPrefEvent("locale_change", locale);
  }, []);

  const setCurrency = useCallback((currency: string) => {
    dispatch({ type: "SET_CURRENCY", payload: currency });
    trackPrefEvent("currency_change", currency);
  }, []);

  const setNotificationPref = useCallback((key: keyof NotificationPrefs, value: boolean) => {
    dispatch({ type: "SET_NOTIFICATION_PREF", payload: { key, value } });
    trackPrefEvent("notification_pref_change", `${key}=${String(value)}`);
  }, []);

  const setPrivacyPref = useCallback((key: keyof PrivacyPrefs, value: boolean) => {
    dispatch({ type: "SET_PRIVACY_PREF", payload: { key, value } });
    trackPrefEvent("privacy_pref_change", `${key}=${String(value)}`);
  }, []);

  const setGamePref = useCallback((updates: Partial<GamePrefs>) => {
    dispatch({ type: "SET_GAME_PREF", payload: updates });
    trackPrefEvent("game_pref_change", JSON.stringify(updates));
  }, []);

  const setAccessibilityPref = useCallback((key: keyof AccessibilityPrefs, value: boolean) => {
    dispatch({ type: "SET_ACCESSIBILITY_PREF", payload: { key, value } });
    trackPrefEvent("accessibility_pref_change", `${key}=${String(value)}`);
  }, []);

  const resetPreferences = useCallback(() => {
    dispatch({ type: "RESET" });
    trackPrefEvent("preferences_reset");
  }, []);

  const exportPreferences = useCallback((): string => {
    return JSON.stringify({ version: STORAGE_VERSION, data: prefs }, null, 2);
  }, [prefs]);

  const importPreferences = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json) as PersistedPrefs;
      if (!parsed?.data) return false;
      const merged = deepMerge(DEFAULT_PREFS, parsed.data);
      dispatch({ type: "HYDRATE", payload: merged });
      trackPrefEvent("preferences_import");
      return true;
    } catch {
      return false;
    }
  }, []);

  const value = useMemo<UserPreferencesContextValue>(
    () => ({
      prefs,
      setLocale,
      setCurrency,
      setNotificationPref,
      setPrivacyPref,
      setGamePref,
      setAccessibilityPref,
      resetPreferences,
      exportPreferences,
      importPreferences,
    }),
    [
      prefs,
      setLocale,
      setCurrency,
      setNotificationPref,
      setPrivacyPref,
      setGamePref,
      setAccessibilityPref,
      resetPreferences,
      exportPreferences,
      importPreferences,
    ],
  );

  return (
    <UserPreferencesContext.Provider value={value}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useUserPreferences(): UserPreferencesContextValue {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) throw new Error("useUserPreferences must be used inside <UserPreferencesProvider>");
  return ctx;
}

/** Sliced selector — only re-renders when selected slice changes */
export function usePrefsSelector<T>(selector: (prefs: UserPreferences) => T): T {
  const { prefs } = useUserPreferences();
  return selector(prefs);
}
