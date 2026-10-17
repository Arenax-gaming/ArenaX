"use client";

import { useEffect, useRef, useState } from "react";
import {
  blockedWord,
  chatChannel,
  chatWsUrl,
  loadHistory,
  namedRoom,
  parseChatEvent,
  postChatMessage,
  remember,
  tournamentRoom,
  type ChatLine,
} from "@/lib/inAppChat";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function roomFor(roomId: string): string {
  if (roomId.includes(":")) return roomId;
  if (UUID_RE.test(roomId)) return tournamentRoom(roomId);
  return namedRoom(roomId);
}

/**
 * Tournament and party chat (Issue #1256).
 * `roomId` is a tournament id or a party slug. Messages are filtered, stored
 * locally, posted to the chat API, and applied live from the WebSocket.
 */
export default function ChatPanel({ roomId }: { roomId: string }) {
  const room = roomFor(roomId);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLines(loadHistory(room));
  }, [room]);

  useEffect(() => {
    const url = chatWsUrl();
    if (!url) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      return;
    }
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "subscribe", channel: chatChannel(room) }));
    };
    socket.onmessage = (event) => {
      const line = parseChatEvent(String(event.data), room);
      if (!line) return;
      setLines(remember(line));
    };
    return () => socket.close();
  }, [room]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [lines]);

  const send = async () => {
    const content = draft.trim();
    if (!content) return;
    const blocked = blockedWord(content);
    if (blocked) {
      setError(`That message was blocked (${blocked}).`);
      return;
    }
    setError(null);
    setDraft("");
    const saved = await postChatMessage({ content, roomId: room }).catch(() => null);
    const line: ChatLine = saved ?? {
      id: `local-${Date.now()}`,
      roomId: room,
      senderId: "me",
      body: content,
      createdAt: new Date().toISOString(),
    };
    setLines(remember(line));
  };

  return (
    <div className="bg-white/10 backdrop-blur-lg rounded-xl border border-white/20 p-6">
      <h3 className="text-xl font-bold text-white mb-4">Chat</h3>
      <div className="h-64 overflow-y-auto mb-4 space-y-2" role="log" aria-live="polite">
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">Chat messages will appear here...</p>
        ) : (
          lines.map((line) => (
            <p key={line.id} className="text-sm text-white/90 break-words">
              <span className="text-white/50">{line.senderId === "me" ? "You" : "Player"}: </span>
              {line.body}
            </p>
          ))
        )}
        <div ref={bottom} />
      </div>
      {error && <p className="mb-2 text-sm text-red-300">{error}</p>}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message..."
          aria-label="Chat message"
          className="w-full px-4 py-2 bg-surface/50 border border-border rounded-lg text-white placeholder-gray-500"
        />
      </form>
    </div>
  );
}
