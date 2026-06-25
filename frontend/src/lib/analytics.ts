"use client";

import type {
  AnalyticsAdapter,
  AnalyticsEventName,
  AnalyticsPayload,
  ConsentState,
  SessionProperties,
} from "@/types/analytics";

const CONSENT_KEY = "arenax:analytics:consent";
const SESSION_KEY = "arenax:analytics:session";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadConsent(): ConsentState {
  if (typeof window === "undefined") return { analytics: "pending", updatedAt: null };
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (raw) return JSON.parse(raw) as ConsentState;
  } catch {
    // ignore
  }
  return { analytics: "pending", updatedAt: null };
}

function saveConsent(state: ConsentState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONSENT_KEY, JSON.stringify(state));
}

function loadOrCreateSession(userId?: string): SessionProperties {
  if (typeof window === "undefined") {
    return {
      sessionId: generateId(),
      userId,
      deviceType: "unknown",
      screenWidth: 0,
      screenHeight: 0,
      sessionStart: Date.now(),
    };
  }
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const existing = JSON.parse(raw) as SessionProperties;
      if (userId && !existing.userId) {
        existing.userId = userId;
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(existing));
      }
      return existing;
    }
  } catch {
    // ignore
  }
  const session: SessionProperties = {
    sessionId: generateId(),
    userId,
    deviceType: getDeviceType(),
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    sessionStart: Date.now(),
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function getDeviceType(): string {
  if (typeof navigator === "undefined") return "unknown";
  if (/Mobi|Android/i.test(navigator.userAgent)) return "mobile";
  if (/Tablet|iPad/i.test(navigator.userAgent)) return "tablet";
  return "desktop";
}

export class AnalyticsService {
  private adapters: AnalyticsAdapter[] = [];
  private consent: ConsentState;
  private session: SessionProperties;

  constructor() {
    this.consent = loadConsent();
    this.session = loadOrCreateSession();
  }

  // ── Adapter management ────────────────────────────────────────────────────

  registerAdapter(adapter: AnalyticsAdapter): void {
    if (!this.adapters.find((a) => a.name === adapter.name)) {
      this.adapters.push(adapter);
    }
  }

  // ── Consent ───────────────────────────────────────────────────────────────

  getConsent(): ConsentState {
    return { ...this.consent };
  }

  setConsent(analytics: "granted" | "denied"): void {
    this.consent = { analytics, updatedAt: Date.now() };
    saveConsent(this.consent);

    if (analytics === "denied") {
      this.scrubSession();
    }
  }

  private scrubSession(): void {
    if (typeof window === "undefined") return;
    // Remove ephemeral identifiers on opt-out
    sessionStorage.removeItem(SESSION_KEY);
    this.session = {
      sessionId: "anonymous",
      deviceType: "unknown",
      screenWidth: 0,
      screenHeight: 0,
      sessionStart: 0,
    };
  }

  // ── Session ───────────────────────────────────────────────────────────────

  getSession(): SessionProperties {
    return { ...this.session };
  }

  identify(userId: string, traits?: Record<string, unknown>): void {
    if (this.consent.analytics !== "granted") return;
    this.session.userId = userId;
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
      } catch {
        // ignore
      }
    }
    this.adapters.forEach((a) => a.identify?.(userId, traits));
  }

  reset(): void {
    this.scrubSession();
    this.adapters.forEach((a) => a.reset?.());
  }

  // ── Tracking ──────────────────────────────────────────────────────────────

  track(event: AnalyticsEventName, props?: Record<string, unknown>): void {
    if (this.consent.analytics !== "granted") return;

    const payload: AnalyticsPayload = {
      event,
      timestamp: Date.now(),
      sessionId: this.session.sessionId,
      userId: this.session.userId,
      ...(props ?? {}),
    } as AnalyticsPayload;

    this.adapters.forEach((a) => a.track(payload));
  }
}

// Singleton
let _instance: AnalyticsService | null = null;

export function getAnalyticsService(): AnalyticsService {
  if (!_instance) _instance = new AnalyticsService();
  return _instance;
}
