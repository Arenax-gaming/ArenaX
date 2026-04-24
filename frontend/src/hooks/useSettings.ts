"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  KeyBinding,
} from "@/types/settings";
import { mockUserSettings, defaultSettings } from "@/data/settings";

// Local storage keys
const SETTINGS_STORAGE_KEY = "arenax_user_settings";
const SETTINGS_VERSION = "1.0";

// Settings validation functions
const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password: string): boolean => {
  // At least 8 characters, one uppercase, one lowercase, one number
  return password.length >= 8;
};

export function useSettings() {
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [originalSettings, setOriginalSettings] = useState<UserSettings>(defaultSettings);

  // Load settings from localStorage on mount
  useEffect(() => {
    const loadSettings = () => {
      try {
        const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings) as UserSettings;
          setSettings(parsed);
          setOriginalSettings(parsed);
        } else {
          // Use mock settings for development
          setSettings(mockUserSettings);
          setOriginalSettings(mockUserSettings);
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
        setSettings(mockUserSettings);
        setOriginalSettings(mockUserSettings);
      }
      setIsLoading(false);
    };

    loadSettings();
  }, []);

  // Check for unsaved changes
  useEffect(() => {
    const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);
    setUnsavedChanges(hasChanges);
  }, [settings, originalSettings]);

  // Validate settings
  const validateSettings = useCallback((): ValidationError[] => {
    const newErrors: ValidationError[] = [];

    // Validate email
    if (!validateEmail(settings.account.email)) {
      newErrors.push({ field: "email", message: "Please enter a valid email address" });
    }

    // Validate password if changing
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

    // Validate game settings
    if (settings.game.fov < 60 || settings.game.fov > 120) {
      newErrors.push({ field: "fov", message: "FOV must be between 60 and 120" });
    }

    if (settings.game.sensitivity < 1 || settings.game.sensitivity > 100) {
      newErrors.push({ field: "sensitivity", message: "Sensitivity must be between 1 and 100" });
    }

    // Validate accessibility settings
    if (settings.accessibility.textScale < 50 || settings.accessibility.textScale > 200) {
      newErrors.push({ field: "textScale", message: "Text scale must be between 50% and 200%" });
    }

    if (settings.accessibility.uiScale < 50 || settings.accessibility.uiScale > 150) {
      newErrors.push({ field: "uiScale", message: "UI scale must be between 50% and 150%" });
    }

    setErrors(newErrors);
    return newErrors;
  }, [settings]);

  // Save settings to localStorage
  const saveSettings = useCallback(async (): Promise<boolean> => {
    setIsSaving(true);
    const validationErrors = validateSettings();

    if (validationErrors.length > 0) {
      setIsSaving(false);
      return false;
    }

    try {
      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
  }, [settings, validateSettings]);

  // Reset settings to original values
  const resetSettings = useCallback(() => {
    setSettings(originalSettings);
    setErrors([]);
  }, [originalSettings]);

  // Reset to default settings
  const resetToDefaults = useCallback(() => {
    setSettings(defaultSettings);
    setOriginalSettings(defaultSettings);
    setErrors([]);
    setUnsavedChanges(false);
  }, []);

  // Update account settings
  const updateAccount = useCallback((updates: Partial<AccountSettings>) => {
    setSettings((prev) => ({
      ...prev,
      account: { ...prev.account, ...updates },
    }));
  }, []);

  // Update game preferences
  const updateGame = useCallback((updates: Partial<GamePreferences>) => {
    setSettings((prev) => ({
      ...prev,
      game: { ...prev.game, ...updates },
    }));
  }, []);

  // Update notification settings
  const updateNotifications = useCallback((updates: Partial<NotificationPreference>) => {
    setSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, ...updates },
    }));
  }, []);

  // Update privacy settings
  const updatePrivacy = useCallback((updates: Partial<PrivacySettings>) => {
    setSettings((prev) => ({
      ...prev,
      privacy: { ...prev.privacy, ...updates },
    }));
  }, []);

  // Update accessibility settings
  const updateAccessibility = useCallback((updates: Partial<AccessibilityOptions>) => {
    setSettings((prev) => ({
      ...prev,
      accessibility: { ...prev.accessibility, ...updates },
    }));
  }, []);

  // Update theme settings
  const updateTheme = useCallback((updates: Partial<ThemeSettings>) => {
    setSettings((prev) => ({
      ...prev,
      theme: { ...prev.theme, ...updates },
    }));
  }, []);

  // Update key binding
  const updateKeyBinding = useCallback((action: string, key: string, isPrimary: boolean = true) => {
    setSettings((prev) => ({
      ...prev,
      game: {
        ...prev.game,
        controls: prev.game.controls.map((binding) =>
          binding.action === action
            ? { ...binding, ...(isPrimary ? { primaryKey: key } : { secondaryKey: key }) }
            : binding
        ),
      },
    }));
  }, []);

  // Reset key binding
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

  // Export settings
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

  // Import settings
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

  // Download settings file
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

  // Get error for specific field
  const getFieldError = useCallback(
    (field: string): string | undefined => {
      return errors.find((e) => e.field === field)?.message;
    },
    [errors]
  );

  // Computed values
  const hasErrors = useMemo(() => errors.length > 0, [errors]);

  return {
    // State
    settings,
    isLoading,
    isSaving,
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