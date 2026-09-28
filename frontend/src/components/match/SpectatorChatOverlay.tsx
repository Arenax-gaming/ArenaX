"use client";

/**
 * SpectatorChatOverlay — Issue #895
 *
 * A collapsible, floating chat panel anchored to the bottom-right of the
 * spectator view. Spectators can read and send messages without leaving the
 * match feed. Designed to be used inside a `position: relative` container.
 *
 * Accessibility:
 * - Live region for incoming messages (role="log" aria-live="polite")
 * - Keyboard-navigable send form
 * - Focusable open/close toggle
 */

import React, { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SpectatorChatMessage } from "@/types/match";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SpectatorChatOverlayProps {
  messages: SpectatorChatMessage[];
  currentUserId: string;
  currentUserName: string;
  /** Whether the WS is currently connected */
  isConnected: boolean;
  /** Called when the user submits a message */
  onSendMessage: (content: string) => void;
  /** Total number of spectators currently watching */
  spectatorCount?: number;
  className?: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isOwn,
}: {
  msg: SpectatorChatMessage;
  isOwn: boolean;
}) {
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}>
      {!isOwn && (
        <span className="mb-0.5 pl-1 text-[10px] font-semibold text-cyan-300/80 truncate max-w-[140px]">
          {msg.senderName}
        </span>
      )}
      <div
        className={cn(
          "max-w-[200px] rounded-2xl px-3 py-2 text-xs break-words [overflow-wrap:anywhere]",
          isOwn
            ? "bg-cyan-500/20 text-cyan-50 rounded-tr-sm"
            : "bg-white/10 text-white/90 rounded-tl-sm",
          msg.optimistic && "opacity-60",
        )}
      >
        {msg.content}
      </div>
      <span className="mt-0.5 px-1 text-[9px] text-white/30">{time}</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SpectatorChatOverlay({
  messages,
  currentUserId,
  currentUserName,
  isConnected,
  onSendMessage,
  spectatorCount,
  className,
}: SpectatorChatOverlayProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevMessageCountRef = useRef(messages.length);

  // Scroll to the newest message whenever the panel is open
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setUnreadCount(0);
    }
  }, [messages.length, isOpen]);

  // Count unread messages while panel is closed
  useEffect(() => {
    if (!isOpen && messages.length > prevMessageCountRef.current) {
      const newCount = messages.length - prevMessageCountRef.current;
      setUnreadCount((prev) => prev + newCount);
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, isOpen]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || !isConnected) return;
    onSendMessage(draft.trim());
    setDraft("");
  };

  const handleToggle = () => setIsOpen((prev) => !prev);

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3",
        className,
      )}
      aria-label="Spectator chat"
    >
      {/* ── Expanded chat panel ──────────────────────────────────────── */}
      {isOpen && (
        <div
          className="flex flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[rgba(15,23,42,0.92)] shadow-[0_8px_40px_rgba(0,0,0,0.6)] backdrop-blur-md"
          style={{ width: 280, height: 400 }}
          role="dialog"
          aria-label="Spectator chat panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4 text-cyan-400" aria-hidden="true" />
              <span className="text-sm font-semibold text-white">
                Spectator Chat
              </span>
              {spectatorCount !== undefined && spectatorCount > 0 && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
                  {spectatorCount.toLocaleString()} watching
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleToggle}
              className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label="Close chat"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Messages */}
          <div
            role="log"
            aria-live="polite"
            aria-label="Spectator chat messages"
            className="flex-1 overflow-y-auto px-3 py-3 space-y-2"
          >
            {messages.length === 0 ? (
              <p className="text-center text-xs text-white/30 pt-8">
                No messages yet. Say hello!
              </p>
            ) : (
              messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  isOwn={msg.senderId === currentUserId}
                />
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form
            onSubmit={handleSend}
            className="flex items-center gap-2 border-t border-white/10 px-3 py-3"
          >
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={
                isConnected
                  ? `Message as ${currentUserName}…`
                  : "Connecting…"
              }
              disabled={!isConnected}
              maxLength={280}
              className="flex-1 rounded-full bg-white/10 px-4 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-400 disabled:opacity-50"
              aria-label="Chat message input"
            />
            <button
              type="submit"
              disabled={!draft.trim() || !isConnected}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-500 text-white transition-colors hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Send message"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </form>
        </div>
      )}

      {/* ── Toggle button ────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          "relative flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2",
          isOpen
            ? "bg-white/10 text-white hover:bg-white/20"
            : "bg-cyan-500 text-white hover:bg-cyan-400",
        )}
        aria-label={isOpen ? "Close spectator chat" : "Open spectator chat"}
        aria-expanded={isOpen}
      >
        {isOpen ? (
          <X className="h-5 w-5" aria-hidden="true" />
        ) : (
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
        )}

        {/* Unread badge */}
        {!isOpen && unreadCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white"
            aria-label={`${unreadCount} unread messages`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </div>
  );
}
