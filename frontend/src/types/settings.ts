// Settings-related types for ArenaX settings system

// Account settings
export interface AccountSettings {
  email: string;
  username: string;
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
  twoFactorEnabled: boolean;
}

// Game preferences
export type GameQuality = "low" | "medium" | "high" | "ultra";
export type FrameRate = 30 | 60 | 120 | 144 | 240;
export type Resolution = "720p" | "1080p" | "1440p" | "2160p" | "native";

export interface GamePreferences {
  quality: GameQuality;
  frameRate: FrameRate;
  resolution: Resolution;
  fullscreen: boolean;
  vsync: boolean;
  fov: number;
  sensitivity: number;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  controls: KeyBinding[];
}

// Key binding
export interface KeyBinding {
  action: string;
  primaryKey: string;
  secondaryKey?: string;
}

// Notification settings
export type NotificationChannel = "email" | "push" | "sms" | "in-app";

export interface NotificationPreference {
  matchStarted: boolean;
  matchEnded: boolean;
  friendOnline: boolean;
  friendRequest: boolean;
  partyInvite: boolean;
  tournamentReminder: boolean;
  systemAnnouncement: boolean;
  marketing: boolean;
  channels: NotificationChannel[];
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
}

// Privacy settings
export type DataVisibility = "public" | "friends" | "private";

export interface PrivacySettings {
  profileVisibility: DataVisibility;
  showOnlineStatus: boolean;
  showGameActivity: boolean;
  showMatchHistory: boolean;
  showEloRating: boolean;
  allowFriendRequests: boolean;
  allowPartyInvites: boolean;
  allowDirectMessages: boolean;
  dataCollection: boolean;
  analyticsTracking: boolean;
  personalizedAds: boolean;
  blockedUsers: string[];
}

// Accessibility options
export interface AccessibilityOptions {
  highContrastMode: boolean;
  colorblindMode: "none" | "deuteranopia" | "protanopia" | "tritanopia";
  textScale: number;
  uiScale: number;
  screenReaderSupport: boolean;
  reducedMotion: boolean;
  subtitlesEnabled: boolean;
  subtitleSize: "small" | "medium" | "large";
  customKeybindings: boolean;
  stickyKeys: boolean;
}

// Theme settings
export type ThemeMode = "light" | "dark" | "system";
export type AccentColor = "blue" | "purple" | "green" | "orange" | "red" | "pink";

export interface ThemeSettings {
  mode: ThemeMode;
  accentColor: AccentColor;
  compactMode: boolean;
  animationsEnabled: boolean;
}

// Combined settings type
export interface UserSettings {
  account: AccountSettings;
  game: GamePreferences;
  notifications: NotificationPreference;
  privacy: PrivacySettings;
  accessibility: AccessibilityOptions;
  theme: ThemeSettings;
}

// Settings validation errors
export interface ValidationError {
  field: string;
  message: string;
}

// Settings import/export
export interface SettingsExport {
  version: string;
  exportedAt: string;
  settings: Partial<UserSettings>;
}