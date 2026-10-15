/**
 * In-app chat helpers (Issue #1256).
 *
 * Rooms:
 * - `tournament:{id}` for a tournament
 * - `dm:{userA}:{userB}` for a direct message, ids sorted so both sides agree
 * - `room:{slug}` for a named room such as a party
 *
 * History is kept in localStorage. The server copy lives at
 * `GET/POST /api/chat/history` and `/api/chat/messages`, and live messages
 * arrive on the WebSocket channel `chat:{room}`.
 */

export interface ChatLine {
  id: string;
  roomId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

const BANNED = [
  "shit",
  "fuck",
  "bitch",
  "ass",
  "damn",
  "hell",
  "bastard",
  "crap",
  "piss",
  "dick",
  "cock",
  "pussy",
];

const HISTORY_CAP = 200;

export function tournamentRoom(tournamentId: string): string {
  return `tournament:${tournamentId}`;
}

export function directRoom(a: string, b: string): string {
  const [left, right] = [a, b].sort();
  return `dm:${left}:${right}`;
}

export function namedRoom(slug: string): string {
  const clean = slug.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return `room:${clean || "general"}`;
}

export function chatChannel(roomId: string): string {
  return roomId.startsWith("chat:") ? roomId : `chat:${roomId}`;
}

/** The blocked word, when `text` contains one as a whole word. */
export function blockedWord(text: string): string | null {
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  return BANNED.find((word) => words.includes(word)) ?? null;
}

export function loadHistory(roomId: string): ChatLine[] {
  const store = browserStorage();
  if (!store) return [];
  try {
    const raw = store.getItem(storageKey(roomId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatLine[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function remember(line: ChatLine): ChatLine[] {
  const existing = loadHistory(line.roomId).filter((item) => item.id !== line.id);
  const next = [...existing, line].slice(-HISTORY_CAP);
  const store = browserStorage();
  if (store) {
    try {
      store.setItem(storageKey(line.roomId), JSON.stringify(next));
    } catch {
      // A full or blocked store should not stop the message from showing.
    }
  }
  return next;
}

export function chatWsUrl(): string {
  if (typeof window === "undefined") return "";
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export async function postChatMessage(input: {
  content: string;
  roomId?: string;
  tournamentId?: string;
  toUserId?: string;
}): Promise<ChatLine | null> {
  const response = await fetch("/api/chat/messages", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: input.content,
      room_id: input.roomId,
      tournament_id: input.tournamentId,
      to_user_id: input.toUserId,
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { data?: ChatLine & { room_id?: string; sender_id?: string; created_at?: string } };
  const data = payload.data;
  if (!data) return null;
  return {
    id: data.id,
    roomId: data.roomId ?? data.room_id ?? input.roomId ?? "",
    senderId: data.senderId ?? data.sender_id ?? "",
    body: data.body,
    createdAt: data.createdAt ?? data.created_at ?? new Date().toISOString(),
  };
}

export function parseChatEvent(raw: string, roomId: string): ChatLine | null {
  try {
    const message = JSON.parse(raw) as {
      event?: {
        type?: string;
        room_id?: string;
        message_id?: string;
        sender_id?: string;
        body?: string;
        timestamp?: string;
      };
    };
    const event = message.event;
    if (!event || event.type !== "chat_message" || event.room_id !== roomId) return null;
    if (!event.message_id || !event.sender_id || !event.body) return null;
    return {
      id: event.message_id,
      roomId: event.room_id,
      senderId: event.sender_id,
      body: event.body,
      createdAt: event.timestamp ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function storageKey(roomId: string): string {
  return `arenax.chat.${roomId}`;
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
