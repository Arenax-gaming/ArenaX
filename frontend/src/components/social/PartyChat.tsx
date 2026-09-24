"use client";

/**
 * PartyChat — issue #1102.
 *
 * Real-time chat surface for a party. Reuses the #697 realtime-messages
 * layer (WebSocketManager + MessageStore) so messages survive offline /
 * reloads and are optimistically rendered. The conversation id is derived
 * from the party id (`party-<id>`), which the conversations list also uses
 * for party conversations (see `Conversation.type === 'party'`).
 */

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Loader } from "lucide-react";
import { useRealtimeMessages } from "@/messages/useRealtimeMessages";
import type { ChatMessage } from "@/messages/messageStore";
import { useAuth } from "@/hooks/useAuth";

interface PartyChatProps {
  partyId: string;
  className?: string;
}

export function PartyChat({ partyId, className }: PartyChatProps) {
  const { user } = useAuth();
  const [draft, setDraft] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const conversationId = `party-${partyId}`;
  const { messages, status, sendMessage } = useRealtimeMessages({
    conversationId,
  });

  const currentUserId = user?.id;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    sendMessage(draft.trim());
    setDraft("");
  };

  return (
    <div
      className={
        "flex flex-col rounded-xl border border-white/15 bg-white/5 backdrop-blur-lg p-4" +
        (className ? ` ${className}` : "")
      }
    >
      <div className="flex items-center gap-2 mb-3">
        <MessageCircle className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-white">Party Chat</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {status === "connected"
            ? "Live"
            : status === "connecting" || status === "reconnecting"
              ? "Connecting…"
              : "Offline"}
        </span>
      </div>

      <div
        className="h-64 overflow-y-auto mb-3 space-y-2"
        aria-live="polite"
        aria-label="Party chat messages"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No messages yet. Say hi to your party!
          </p>
        ) : (
          messages.map((message: ChatMessage) => {
            const isOwn = currentUserId != null && message.senderId === currentUserId;
            return (
              <div
                key={message.id}
                className={`flex flex-col ${isOwn ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    isOwn
                      ? "bg-primary/90 text-white"
                      : "bg-white/10 text-white/90"
                  }`}
                >
                  {!isOwn && (
                    <span className="block text-xs font-medium opacity-80 mb-0.5">
                      {message.senderName}
                    </span>
                  )}
                  {message.content}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message..."
          aria-label="Party chat message"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface/50 border border-white/15 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-primary"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Send message"
          className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-primary/90 hover:bg-primary text-white transition-colors disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>

      {status === "connecting" || status === "reconnecting" ? (
        <p className="mt-2 text-xs text-muted-foreground inline-flex items-center gap-1">
          <Loader className="h-3 w-3 animate-spin" />
          Syncing messages…
        </p>
      ) : null}
    </div>
  );
}

export default PartyChat;