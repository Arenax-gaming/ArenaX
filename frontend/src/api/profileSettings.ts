/**
 * Profile settings API (Issue #1396): avatar upload and granular
 * notification preferences.
 *
 * Uses `pinnedFetch` directly rather than `api.request` because the avatar
 * upload is multipart — `ApiClient.request` always forces a JSON
 * Content-Type, which would break the multipart boundary.
 */

import { pinnedFetch } from "./certificatePinning";
import { API_BASE } from "@/lib/constants";

// ─── Avatar validation ────────────────────────────────────────────────────────

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const AVATAR_ACCEPTED_TYPES = ["image/jpeg", "image/png"] as const;
export type AvatarMimeType = (typeof AVATAR_ACCEPTED_TYPES)[number];
/** Side length of the uploaded square avatar, in pixels. */
export const AVATAR_OUTPUT_SIZE = 512;

export type AvatarValidationError = "unsupported-type" | "too-large" | "empty" | "corrupt";

export const AVATAR_ERROR_MESSAGES: Record<AvatarValidationError, string> = {
  "unsupported-type": "Please choose a JPG or PNG image.",
  "too-large": "Images must be 2 MB or smaller.",
  empty: "That file is empty.",
  corrupt: "That file isn't a valid JPG or PNG image.",
};

function hasImageSignature(bytes: Uint8Array, type: AvatarMimeType): boolean {
  if (type === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return png.every((byte, i) => bytes[i] === byte);
}

/**
 * Validate an avatar file: JPG/PNG only (by MIME type *and* file signature,
 * so a renamed file is rejected), non-empty, and at most 2 MB.
 */
export async function validateAvatarFile(
  file: Blob
): Promise<AvatarValidationError | null> {
  if (!(AVATAR_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "unsupported-type";
  }
  if (file.size === 0) return "empty";
  if (file.size > AVATAR_MAX_BYTES) return "too-large";

  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!hasImageSignature(header, file.type as AvatarMimeType)) return "corrupt";
  return null;
}

// ─── CDN URLs ─────────────────────────────────────────────────────────────────

/** Hex SHA-256 of a blob, used as a content-addressed cache-busting version. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Serve an avatar from the CDN with a cache-busting version.
 *
 * Relative paths are prefixed with `NEXT_PUBLIC_CDN_URL` when it is set.
 * `v=<version>` replaces any previous version, so a re-uploaded avatar at the
 * same path is never served stale from a browser or edge cache.
 */
export function cdnAvatarUrl(
  url: string,
  version: string,
  cdnBase: string | undefined = process.env.NEXT_PUBLIC_CDN_URL
): string {
  const base =
    cdnBase && url.startsWith("/") ? `${cdnBase.replace(/\/+$/, "")}${url}` : url;
  const isAbsolute = /^https?:\/\//i.test(base);
  const parsed = new URL(base, "http://placeholder.invalid");
  parsed.searchParams.set("v", version);
  return isAbsolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

// ─── Requests ─────────────────────────────────────────────────────────────────

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      (body.message as string | undefined) ??
      ((body.error as { message?: string } | undefined)?.message) ??
      `Request failed (HTTP ${response.status})`;
    throw new Error(message);
  }
  // Tolerate both `{ data: T }` envelopes and bare payloads.
  return ("data" in body ? body.data : body) as T;
}

export interface AvatarUploadResult {
  /** CDN URL with cache-busting version, ready for <img src>. */
  avatarUrl: string;
  version: string;
}

/** Upload a (cropped) avatar image. */
export async function uploadAvatar(
  image: Blob,
  filename = "avatar"
): Promise<AvatarUploadResult> {
  const error = await validateAvatarFile(image);
  if (error) throw new Error(AVATAR_ERROR_MESSAGES[error]);

  const extension = image.type === "image/png" ? "png" : "jpg";
  const form = new FormData();
  form.append("avatar", image, `${filename}.${extension}`);

  // No Content-Type header: the browser sets the multipart boundary.
  const response = await pinnedFetch(`${API_BASE}/users/me/avatar`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  const data = await readJson<{ avatar_url: string; version?: string; hash?: string }>(response);

  const version = data.version ?? data.hash ?? (await sha256Hex(image)).slice(0, 16);
  return { avatarUrl: cdnAvatarUrl(data.avatar_url, version), version };
}

// ─── Notification preferences ─────────────────────────────────────────────────

export const NOTIFICATION_CHANNELS = ["email", "push", "in-app"] as const;
export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_EVENTS = [
  { key: "match_found", label: "Match found", description: "A matchmaking queue found your opponents" },
  { key: "match_result", label: "Match results", description: "Final scores and ELO changes" },
  { key: "tournament_start", label: "Tournament starting", description: "Check-in opens or your bracket begins" },
  { key: "tournament_result", label: "Tournament results", description: "Placements and prize payouts" },
  { key: "friend_request", label: "Friend requests", description: "Someone wants to add you" },
  { key: "direct_message", label: "Direct messages", description: "New messages from other players" },
  { key: "reward", label: "Rewards & achievements", description: "Unlocked achievements and claimable rewards" },
  { key: "security", label: "Security alerts", description: "New sign-ins and account changes" },
] as const;
export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]["key"];

export type NotificationPreferenceMatrix = Record<
  NotificationEventKey,
  Record<NotificationChannelKey, boolean>
>;

/** Defaults: everything in-app; push for time-sensitive events; email for results and security. */
export function defaultNotificationPreferences(): NotificationPreferenceMatrix {
  const pushOn = new Set<NotificationEventKey>(["match_found", "tournament_start", "direct_message", "security"]);
  const emailOn = new Set<NotificationEventKey>(["tournament_result", "security"]);
  return Object.fromEntries(
    NOTIFICATION_EVENTS.map(({ key }) => [
      key,
      { email: emailOn.has(key), push: pushOn.has(key), "in-app": true },
    ])
  ) as NotificationPreferenceMatrix;
}

/** Fill gaps from the server response with defaults, so new events show up. */
export function mergeWithDefaults(
  partial: Partial<Record<string, Partial<Record<string, boolean>>>> | null | undefined
): NotificationPreferenceMatrix {
  const merged = defaultNotificationPreferences();
  for (const { key } of NOTIFICATION_EVENTS) {
    for (const channel of NOTIFICATION_CHANNELS) {
      const value = partial?.[key]?.[channel];
      if (typeof value === "boolean") merged[key][channel] = value;
    }
  }
  return merged;
}

export async function getNotificationPreferences(): Promise<NotificationPreferenceMatrix> {
  const response = await pinnedFetch(`${API_BASE}/users/me/notification-preferences`, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const data = await readJson<{ preferences?: Record<string, Record<string, boolean>> }>(response);
  return mergeWithDefaults(data.preferences);
}

export async function saveNotificationPreferences(
  preferences: NotificationPreferenceMatrix
): Promise<NotificationPreferenceMatrix> {
  const response = await pinnedFetch(`${API_BASE}/users/me/notification-preferences`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ preferences }),
  });
  const data = await readJson<{ preferences?: Record<string, Record<string, boolean>> }>(response);
  return mergeWithDefaults(data.preferences ?? preferences);
}
