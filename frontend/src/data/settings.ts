import type { UserSettings, KeyBinding } from "@/types/settings";

// Default key bindings
export const defaultKeyBindings: KeyBinding[] = [
  { action: "Move Forward", primaryKey: "W" },
  { action: "Move Back", primaryKey: "S" },
  { action: "Move Left", primaryKey: "A" },
  { action: "Move Right", primaryKey: "D" },
  { action: "Jump", primaryKey: "Space" },
  { action: "Crouch", primaryKey: "Ctrl" },
  { action: "Interact", primaryKey: "E" },
  { action: "Reload", primaryKey: "R" },
  { action: "Use Ability 1", primaryKey: "Q" },
  { action: "Use Ability 2", primaryKey: "Shift" },
  { action: "Use Ultimate", primaryKey: "F" },
  { action: "Open Menu", primaryKey: "Escape" },
  { action: "Open Map", primaryKey: "M" },
  { action: "Open Scoreboard", primaryKey: "Tab" },
  { action: "Voice Chat", primaryKey: "V" },
  { action: "Ping", primaryKey: "G" },
];

// Default settings
export const defaultSettings: UserSettings = {
  account: {
    email: "",
    username: "",
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
    twoFactorEnabled: false,
  },
  game: {
    quality: "high",
    frameRate: 144,
    resolution: "native",
    fullscreen: true,
    vsync: false,
    fov: 90,
    sensitivity: 50,
    masterVolume: 80,
    musicVolume: 60,
    sfxVolume: 80,
    voiceVolume: 70,
    controls: defaultKeyBindings,
  },
  notifications: {
    matchStarted: true,
    matchEnded: true,
    friendOnline: true,
    friendRequest: true,
    partyInvite: true,
    tournamentReminder: true,
    systemAnnouncement: true,
    marketing: false,
    channels: ["push", "in-app"],
    quietHours: {
      enabled: true,
      start: "23:00",
      end: "07:00",
    },
  },
  privacy: {
    profileVisibility: "public",
    showOnlineStatus: true,
    showGameActivity: true,
    showMatchHistory: true,
    showEloRating: true,
    allowFriendRequests: true,
    allowPartyInvites: true,
    allowDirectMessages: true,
    dataCollection: true,
    analyticsTracking: true,
    personalizedAds: false,
    blockedUsers: [],
  },
  accessibility: {
    highContrastMode: false,
    colorblindMode: "none",
    textScale: 100,
    uiScale: 100,
    screenReaderSupport: false,
    reducedMotion: false,
    subtitlesEnabled: false,
    subtitleSize: "medium",
    customKeybindings: false,
    stickyKeys: false,
  },
  theme: {
    mode: "dark",
    accentColor: "blue",
    compactMode: false,
    animationsEnabled: true,
  },
};

// Mock user settings (for development)
export const mockUserSettings: UserSettings = {
  account: {
    email: "player@arenax.gg",
    username: "ProGamer123",
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
    twoFactorEnabled: true,
  },
  game: {
    quality: "ultra",
    frameRate: 144,
    resolution: "native",
    fullscreen: true,
    vsync: false,
    fov: 100,
    sensitivity: 65,
    masterVolume: 80,
    musicVolume: 50,
    sfxVolume: 90,
    voiceVolume: 75,
    controls: defaultKeyBindings,
  },
  notifications: {
    matchStarted: true,
    matchEnded: true,
    friendOnline: true,
    friendRequest: true,
    partyInvite: true,
    tournamentReminder: true,
    systemAnnouncement: true,
    marketing: false,
    channels: ["push", "in-app", "email"],
    quietHours: {
      enabled: true,
      start: "23:00",
      end: "07:00",
    },
  },
  privacy: {
    profileVisibility: "public",
    showOnlineStatus: true,
    showGameActivity: true,
    showMatchHistory: true,
    showEloRating: true,
    allowFriendRequests: true,
    allowPartyInvites: true,
    allowDirectMessages: true,
    dataCollection: true,
    analyticsTracking: false,
    personalizedAds: false,
    blockedUsers: ["toxic_player", "cheater123"],
  },
  accessibility: {
    highContrastMode: false,
    colorblindMode: "none",
    textScale: 100,
    uiScale: 100,
    screenReaderSupport: false,
    reducedMotion: false,
    subtitlesEnabled: true,
    subtitleSize: "medium",
    customKeybindings: true,
    stickyKeys: false,
  },
  theme: {
    mode: "dark",
    accentColor: "blue",
    compactMode: false,
    animationsEnabled: true,
  },
};

// Quality presets
export const qualityPresets = {
  low: {
    label: "Low",
    description: "Best performance, lowest visual quality",
    icon: "📉",
  },
  medium: {
    label: "Medium",
    description: "Balanced performance and visuals",
    icon: "⚖️",
  },
  high: {
    label: "High",
    description: "Great visuals with good performance",
    icon: "✨",
  },
  ultra: {
    label: "Ultra",
    description: "Best visual quality, highest requirements",
    icon: "🔥",
  },
};

// Frame rate options
export const frameRateOptions = [
  { value: 30, label: "30 FPS", description: "Low power consumption" },
  { value: 60, label: "60 FPS", description: "Standard smooth experience" },
  { value: 120, label: "120 FPS", description: "High refresh rate" },
  { value: 144, label: "144 FPS", description: "Gaming monitor standard" },
  { value: 240, label: "240 FPS", description: "Competitive esports" },
];

// Resolution options
export const resolutionOptions = [
  { value: "720p", label: "720p (HD)", width: 1280, height: 720 },
  { value: "1080p", label: "1080p (FHD)", width: 1920, height: 1080 },
  { value: "1440p", label: "1440p (QHD)", width: 2560, height: 1440 },
  { value: "2160p", label: "2160p (4K)", width: 3840, height: 2160 },
  { value: "native", label: "Native", description: "Use display's native resolution" },
];

// Notification types
export const notificationTypes = [
  {
    key: "matchStarted",
    label: "Match Started",
    description: "When a match begins",
    icon: "🎮",
  },
  {
    key: "matchEnded",
    label: "Match Ended",
    description: "When a match concludes with results",
    icon: "🏁",
  },
  {
    key: "friendOnline",
    label: "Friend Online",
    description: "When a friend comes online",
    icon: "👋",
  },
  {
    key: "friendRequest",
    label: "Friend Request",
    description: "When someone sends a friend request",
    icon: "📩",
  },
  {
    key: "partyInvite",
    label: "Party Invite",
    description: "When invited to a party",
    icon: "🎉",
  },
  {
    key: "tournamentReminder",
    label: "Tournament Reminder",
    description: "Reminders about upcoming tournaments",
    icon: "🏆",
  },
  {
    key: "systemAnnouncement",
    label: "System Announcements",
    description: "Important platform updates",
    icon: "📢",
  },
  {
    key: "marketing",
    label: "Marketing & Promotions",
    description: "Special offers and promotions",
    icon: "🎁",
  },
];

// Notification channels
export const notificationChannels = [
  { value: "email", label: "Email", icon: "📧" },
  { value: "push", label: "Push Notification", icon: "📱" },
  { value: "sms", label: "SMS", icon: "💬" },
  { value: "in-app", label: "In-App", icon: "🔔" },
];

// Accent color options
export const accentColors = [
  { value: "blue", label: "Blue", hex: "#3B82F6" },
  { value: "purple", label: "Purple", hex: "#8B5CF6" },
  { value: "green", label: "Green", hex: "#10B981" },
  { value: "orange", label: "Orange", hex: "#F59E0B" },
  { value: "red", label: "Red", hex: "#EF4444" },
  { value: "pink", label: "Pink", hex: "#EC4899" },
];

// Privacy visibility options
export const visibilityOptions = [
  { value: "public", label: "Public", description: "Anyone can see" },
  { value: "friends", label: "Friends Only", description: "Only friends can see" },
  { value: "private", label: "Private", description: "Only you can see" },
];

// Colorblind mode options
export const colorblindModes = [
  { value: "none", label: "None", description: "No colorblind correction" },
  { value: "deuteranopia", label: "Deuteranopia", description: "Red-green colorblindness (most common)" },
  { value: "protanopia", label: "Protanopia", description: "Red-green colorblindness" },
  { value: "tritanopia", label: "Tritanopia", description: "Blue-yellow colorblindness (rare)" },
];