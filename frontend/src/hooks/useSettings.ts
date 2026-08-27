"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type {
  UserSettings,
  AccountSettings,
  GamePreferences,
  NotificationPreference,
  PrivacySettings,
  AccessibilityOptions,
  ThemeSettings,
  ValidationError,
  SettingsExport,
} from "@/types/settings";
import { mockUserSettings, defaultSettings } from "@/data/settings";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/Toast";

// Local storage keys
const SETTINGS_STORAGE_KEY = "arenax_user_settings";
const SETTINGS_VERSION = "1.0";

// Debounce delay for backend sync (ms)
const SYNC_DEBOUNCE_MS = 800;

// ─── Validation helpers ───────────────────────────────────────────────────────

const validateEmail = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const validatePassword = (password: string): boolean =>
  password.length >= 8;

// ─── Strip sensitive account fields before syncing to backend ─────────────────

function sanitiseForSync(settings: UserSettings): Record<string, unknown> {
  const { account, ...rest } = settings;
  const safeAccount: Record<string, unknown> = { ...(account as unknown as Record<string, unknown>) };
  delete safeAccount.newPassword;
  delete safeAccount.confirmNewPassword;
  return { ...rest, account: safeAccount };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type SyncStatus = "idle" | "syncing" | "error";

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [originalSettings, setOriginalSettings] = useState<UserSettings>(defaultSettings);

  // Track whether the initial load is complete so the debounce doesn't fire
  // on the very first state hydration.
  const isInitialLoad = useRef(true);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Load settings on mount ──────────────────────────────────────────────────

  useEffect(() => {
    const loadSettings = async () => {
      // 1. Optimistically load from localStorage so the UI is instant.
      let localSettings: UserSettings = mockUserSettings;
      try {
        const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (saved) {
          localSettings = JSON.parse(saved) as UserSettings;
        }
      } catch {
        // ignore JSON parse errors
      }
      setSettings(localSettings);
      setOriginalSettings(localSettings);
      setIsLoading(false);

      // 2. Fetch from server and merge (server authoritative for non-account fields).
      try {
        const serverData = await api.getSettings();
        if (serverData && typeof serverData === "object") {
          setSettings((prev) => {
            const merged: UserSettings = {
              ...prev,
              ...(serverData as Partial<UserSettings>),
              // Always keep local account credentials; only take server fields.
              account: prev.account,
            };
            // Persist merged result to localStorage.
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
            return merged;
          });
          setOriginalSettings((prev) => ({
            ...prev,
            ...(serverData as Partial<UserSettings>),
            account: prev.account,
          }));
        }
      } catch {
        // Server fetch failed — silently stay with local data.
      } finally {
        isInitialLoad.current = false;
      }
    };

    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Detect unsaved changes ──────────────────────────────────────────────────

  useEffect(() => {
    setUnsavedChanges(JSON.stringify(settings) !== JSON.stringify(originalSettings));
  }, [settings, originalSettings]);

  // ── Debounced backend sync ──────────────────────────────────────────────────

  const syncToBackend = useCallback(async (data: UserSettings) => {
    setSyncStatus("syncing");
    try {
      await api.updateSettings(sanitiseForSync(data) as Record<string, unknown>);
      setSyncStatus("idle");
    } catch (err) {
      setSyncStatus("error");
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.warning(`Settings sync failed: ${msg}. Your changes are saved locally.`);
    }
  }, []);

  useEffect(() => {
    // Skip the first render (initial hydration).
    if (isInitialLoad.current) return;

    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      syncToBackend(settings);
    }, SYNC_DEBOUNCE_MS);

    return () => clearTimeout(debounceTimer.current);
  }, [settings, syncToBackend]);

  // ── Validation ──────────────────────────────────────────────────────────────

  const validateSettings = useCallback((): ValidationError[] => {
    const newErrors: ValidationError[] = [];

    if (!validateEmail(settings.account.email)) {
      newErrors.push({ field: "email", message: "Please enter a valid email address" });
    }

    if (settings.account.newPassword) {
      if (!validatePassword(settings.account.newPassword)) {
        newErrors.push({
          field: "newPassword",
          message: "Password must be at least 8 characters long",
        });
      }
      if (settings.account.newPassword !== settings.account.confirmNewPassword) {
        newErrors.push({
          field: "confirmNewPassword",
          message: "Passwords do not match",
        });
      }
    }

    if (settings.game.fov < 60 || settings.game.fov > 120) {
      newErrors.push({ field: "fov", message: "FOV must be between 60 and 120" });
    }

    if (settings.game.sensitivity < 1 || settings.game.sensitivity > 100) {
      newErrors.push({ field: "sensitivity", message: "Sensitivity must be between 1 and 100" });
    }

    if (settings.accessibility.textScale < 50 || settings.accessibility.textScale > 200) {
      newErrors.push({ field: "textScale", message: "Text scale must be between 50% and 200%" });
    }

    if (settings.accessibility.uiScale < 50 || settings.accessibility.uiScale > 150) {
      newErrors.push({ field: "uiScale", message: "UI scale must be between 50% and 150%" });
    }

    setErrors(newErrors);
    return newErrors;
  }, [settings]);

  // ── Save settings (explicit save + backend sync) ────────────────────────────

  const saveSettings = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    const validationErrors = validateSettings();

    if (validationErrors.length > 0) {
      setIsSaving(false);
      return false;
    }

    try {
      // Persist locally first for instant feedback.
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

      // Flush debounce and sync to backend immediately on explicit save.
      clearTimeout(debounceTimer.current);
      await syncToBackend(settings);

      setOriginalSettings(settings);
      setErrors([]);
      setUnsavedChanges(false);
      return true;
    } catch (error) {
      console.error("Failed to save settings:", error);
      setErrors([{ field: "general", message: "Failed to save settings" }]);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [settings, validateSettings, syncToBackend]);

  // ── Reset ───────────────────────────────────────────────────────────────────

  const resetSettings = useCallback(() => {
    setSettings(originalSettings);
    setErrors([]);
  }, [originalSettings]);

  const resetToDefaults = useCallback(() => {
    setSettings(defaultSettings);
    setOriginalSettings(defaultSettings);
    setErrors([]);
    setUnsavedChanges(false);
  }, []);

  // ── Section updaters ────────────────────────────────────────────────────────

  const updateAccount = useCallback((updates: Partial<AccountSettings>) => {
    setSettings((prev) => ({ ...prev, account: { ...prev.account, ...updates } }));
  }, []);

  const updateGame = useCallback((updates: Partial<GamePreferences>) => {
    setSettings((prev) => ({ ...prev, game: { ...prev.game, ...updates } }));
  }, []);

  const updateNotifications = useCallback((updates: Partial<NotificationPreference>) => {
    setSettings((prev) => ({ ...prev, notifications: { ...prev.notifications, ...updates } }));
  }, []);

  const updatePrivacy = useCallback((updates: Partial<PrivacySettings>) => {
    setSettings((prev) => ({ ...prev, privacy: { ...prev.privacy, ...updates } }));
  }, []);

  const updateAccessibility = useCallback((updates: Partial<AccessibilityOptions>) => {
    setSettings((prev) => ({ ...prev, accessibility: { ...prev.accessibility, ...updates } }));
  }, []);

  const updateTheme = useCallback((updates: Partial<ThemeSettings>) => {
    setSettings((prev) => ({ ...prev, theme: { ...prev.theme, ...updates } }));
  }, []);

  const updateKeyBinding = useCallback(
    (
      action: string,
      key: string,
      isPrimary: boolean = true,
      modifier?: "Ctrl" | "Shift" | "Alt" | "None"
    ) => {
      setSettings((prev) => {
        const existing = prev.game.controls.find((b) => b.action === action);
        const newControls = existing
          ? prev.game.controls.map((binding) =>
              binding.action === action
                ? {
                    ...binding,
                    ...(isPrimary ? { primaryKey: key } : { secondaryKey: key }),
                    ...(modifier !== undefined ? { modifier } : {}),
                  }
                : binding
            )
          : [
              ...prev.game.controls,
              { action, primaryKey: key, modifier: modifier || "None" },
            ];

        return { ...prev, game: { ...prev.game, controls: newControls } };
      });
    },
    []
  );

  const resetKeyBinding = useCallback((action: string) => {
    const defaultBinding = defaultSettings.game.controls.find((b) => b.action === action);
    if (defaultBinding) {
      setSettings((prev) => ({
        ...prev,
        game: {
          ...prev.game,
          controls: prev.game.controls.map((binding) =>
            binding.action === action ? defaultBinding : binding
          ),
        },
      }));
    }
  }, []);

  // ── Import / export ─────────────────────────────────────────────────────────

  const exportSettings = useCallback((): string => {
    const exportData: SettingsExport = {
      version: SETTINGS_VERSION,
      exportedAt: new Date().toISOString(),
      settings: {
        game: settings.game,
        notifications: settings.notifications,
        accessibility: settings.accessibility,
        theme: settings.theme,
      },
    };
    return JSON.stringify(exportData, null, 2);
  }, [settings]);

  const importSettings = useCallback((importData: string): boolean => {
    try {
      const parsed = JSON.parse(importData) as SettingsExport;
      if (parsed.settings) {
        setSettings((prev) => ({
          ...prev,
          game: { ...prev.game, ...parsed.settings.game },
          notifications: { ...prev.notifications, ...parsed.settings.notifications },
          accessibility: { ...prev.accessibility, ...parsed.settings.accessibility },
          theme: { ...prev.theme, ...parsed.settings.theme },
        }));
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to import settings:", error);
      return false;
    }
  }, []);

  const downloadSettings = useCallback(() => {
    const exportData = exportSettings();
    const blob = new Blob([exportData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `arenax-settings-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [exportSettings]);

  // ── Error accessor ──────────────────────────────────────────────────────────

  const getFieldError = useCallback(
    (field: string): string | undefined =>
      errors.find((e) => e.field === field)?.message,
    [errors]
  );

  const hasErrors = useMemo(() => errors.length > 0, [errors]);

  return {
    // State
    settings,
    isLoading,
    isSaving,
    syncStatus,
    errors,
    unsavedChanges,
    hasErrors,

    // Actions
    saveSettings,
    resetSettings,
    resetToDefaults,
    validateSettings,
    updateAccount,
    updateGame,
    updateNotifications,
    updatePrivacy,
    updateAccessibility,
    updateTheme,
    updateKeyBinding,
    resetKeyBinding,
    exportSettings,
    importSettings,
    downloadSettings,
    getFieldError,
  };
}
