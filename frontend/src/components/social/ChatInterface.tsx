"use client";

import { useState, useRef, useEffect } from "react";
import {
  Send,
  Search,
  MoreVertical,
  Phone,
  Video,
  Paperclip,
  Smile,
  Check,
  CheckCheck,
  Clock,
  ArrowLeft,
  Users,
  Flag,
  MicOff,
  Ban,
  History,
  Undo2,
  MoreHorizontal,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AvatarWithStatus } from "./OnlineStatus";
import type { Conversation, Message, SocialUser } from "@/types/social";

/** Mute presets (hours) required by the acceptance criteria. */
export const MUTE_DURATIONS = [1, 24, 72] as const;
export type MuteDuration = (typeof MUTE_DURATIONS)[number];

/**
 * Optional admin moderation surface for the chat (issue #890). When omitted the
 * chat renders exactly as before, so existing (non-admin) call sites are
 * unaffected. Reporting is available to everyone unless `canReport` is false;
 * mute/ban/history are gated behind `isAdmin`.
 */
export interface ChatModerationConfig {
  /** Unlocks mute / ban / message-history actions. */
  isAdmin?: boolean;
  /** Allow reporting messages. Defaults to true. */
  canReport?: boolean;
  /** How long a moderation action can be undone. Defaults to 5 minutes. */
  undoWindowMs?: number;
  /** Users currently muted / banned — used to reflect state in the menu. */
  mutedUserIds?: string[];
  bannedUserIds?: string[];
  onReportMessage?: (
    messageId: string,
    meta: { senderId: string; content: string }
  ) => void;
  onMuteUser?: (userId: string, durationHours: MuteDuration) => void;
  onBanUser?: (userId: string) => void;
  /** Inverse operations, invoked when an action is undone within the window. */
  onUnmuteUser?: (userId: string) => void;
  onUnbanUser?: (userId: string) => void;
  onUndoReport?: (messageId: string) => void;
  /** Optional server-side history fetch; falls back to the loaded messages. */
  onViewUserHistory?: (userId: string) => void;
}

// The chat's runtime message/conversation shape is looser than the exported
// type (it carries senderId/senderName/timestamp); read those fields defensively
// so moderation works regardless of which shape a caller passes.
const getSenderId = (m: Message): string =>
  (m as any).senderId ?? (m as any).fromUserId ?? "";
const getSenderName = (m: Message): string =>
  (m as any).senderName ??
  (m as any).fromUsername ??
  "User";
const getTimestamp = (m: Message): string =>
  (m as any).timestamp ?? (m as any).createdAt ?? "";

interface UndoEntry {
  id: string;
  kind: "report" | "mute" | "ban";
  label: string;
  userId?: string;
  messageId?: string;
}

interface ChatInterfaceProps {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Message[];
  isTyping: boolean;
  currentUser: SocialUser;
  onSelectConversation: (conversation: Conversation) => void;
  onSendMessage: (content: string) => void;
  onSearchConversations?: (query: string) => void;
  /** Admin moderation configuration (issue #890). Omit for a normal chat. */
  moderation?: ChatModerationConfig;
}

export function ChatInterface({
  conversations,
  activeConversation,
  messages,
  isTyping,
  currentUser,
  onSelectConversation,
  onSendMessage,
  onSearchConversations,
  moderation,
}: ChatInterfaceProps) {
  const [messageInput, setMessageInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Moderation state (issue #890) ──
  const moderationEnabled = !!moderation;
  const isAdmin = !!moderation?.isAdmin;
  const canReport = moderation?.canReport !== false;
  const undoWindowMs = moderation?.undoWindowMs ?? 5 * 60 * 1000;
  const mutedUserIds = moderation?.mutedUserIds ?? [];
  const bannedUserIds = moderation?.bannedUserIds ?? [];
  // Nothing to show if the viewer can neither report nor administrate.
  const canModerate = canReport || isAdmin;

  const [openMenuMessageId, setOpenMenuMessageId] = useState<string | null>(null);
  const [historyUser, setHistoryUser] = useState<{ id: string; name: string } | null>(
    null
  );
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const undoTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const undoSeq = useRef(0);

  // Clear any pending undo timers on unmount.
  useEffect(() => {
    const timers = undoTimers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const registerUndo = (entry: Omit<UndoEntry, "id">) => {
    const id = `undo-${(undoSeq.current += 1)}`;
    setUndoStack((prev) => [...prev, { ...entry, id }]);
    undoTimers.current[id] = setTimeout(() => {
      setUndoStack((prev) => prev.filter((e) => e.id !== id));
      delete undoTimers.current[id];
    }, undoWindowMs);
  };

  const dismissUndo = (id: string) => {
    if (undoTimers.current[id]) {
      clearTimeout(undoTimers.current[id]);
      delete undoTimers.current[id];
    }
    setUndoStack((prev) => prev.filter((e) => e.id !== id));
  };

  const handleUndo = (entry: UndoEntry) => {
    switch (entry.kind) {
      case "mute":
        if (entry.userId) moderation?.onUnmuteUser?.(entry.userId);
        break;
      case "ban":
        if (entry.userId) moderation?.onUnbanUser?.(entry.userId);
        break;
      case "report":
        if (entry.messageId) moderation?.onUndoReport?.(entry.messageId);
        break;
    }
    dismissUndo(entry.id);
  };

  const handleReport = (message: Message) => {
    setOpenMenuMessageId(null);
    moderation?.onReportMessage?.(message.id, {
      senderId: getSenderId(message),
      content: message.content,
    });
    registerUndo({
      kind: "report",
      messageId: message.id,
      label: "Message reported",
    });
  };

  const handleMute = (message: Message, hours: MuteDuration) => {
    setOpenMenuMessageId(null);
    const userId = getSenderId(message);
    moderation?.onMuteUser?.(userId, hours);
    registerUndo({
      kind: "mute",
      userId,
      label: `Muted ${getSenderName(message)} for ${
        hours === 1 ? "1 hour" : `${hours} hours`
      }`,
    });
  };

  const handleBan = (message: Message) => {
    setOpenMenuMessageId(null);
    const userId = getSenderId(message);
    moderation?.onBanUser?.(userId);
    registerUndo({
      kind: "ban",
      userId,
      label: `Banned ${getSenderName(message)}`,
    });
  };

  const handleViewHistory = (message: Message) => {
    setOpenMenuMessageId(null);
    const userId = getSenderId(message);
    moderation?.onViewUserHistory?.(userId);
    setHistoryUser({ id: userId, name: getSenderName(message) });
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Escape closes the moderation menu / history dialog (issue #890).
  useEffect(() => {
    if (!openMenuMessageId && !historyUser) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenuMessageId(null);
        setHistoryUser(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openMenuMessageId, historyUser]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (messageInput.trim()) {
      onSendMessage(messageInput.trim());
      setMessageInput("");
      setShowEmojiPicker(false);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getMessageStatus = (message: Message) => {
    switch (message.status) {
      case "sent":
        return <Check className="h-4 w-4 text-muted-foreground" />;
      case "delivered":
        return <CheckCheck className="h-4 w-4 text-muted-foreground" />;
      case "read":
        return <CheckCheck className="h-4 w-4 text-primary" />;
      default:
        return null;
    }
  };

  const getConversationName = (conv: Conversation) => {
    if (conv.type === "party") {
      return "Party Chat";
    }
    if (conv.participants.length === 0) return "Unknown";
    return conv.participants[0].username;
  };

  const getConversationAvatar = (conv: Conversation) => {
    if (conv.type === "party") {
      return undefined;
    }
    if (conv.participants.length === 0) return undefined;
    return conv.participants[0].avatar;
  };

  // Conversation List Item
  const ConversationItem = ({ conv }: { conv: Conversation }) => {
    const isActive = activeConversation?.id === conv.id;
    const name = getConversationName(conv);
    const avatar = getConversationAvatar(conv);

    return (
      <button
        onClick={() => onSelectConversation(conv)}
        className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
          isActive
            ? "bg-primary/10 hover:bg-primary/20"
            : "hover:bg-muted/40"
        }`}
      >
        {conv.type === "party" ? (
          <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <Users className="h-5 w-5 text-primary" />
          </div>
        ) : (
          <AvatarWithStatus
            avatar={avatar}
            username={name}
            status={conv.participants[0]?.status || "offline"}
            size="md"
          />
        )}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center justify-between">
            <span className={`font-medium truncate ${isActive ? "text-primary" : ""}`}>
              {name}
            </span>
            {conv.lastMessage && (
              <span className="text-xs text-muted-foreground shrink-0">
                {formatTime(conv.lastMessage.timestamp)}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground truncate">
              {conv.lastMessage?.content || "No messages yet"}
            </span>
            {conv.unreadCount > 0 && (
              <span className="ml-2 h-5 min-w-[20px] flex items-center justify-center bg-primary text-primary-foreground text-xs font-bold rounded-full px-1.5 shrink-0">
                {conv.unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <Card className="h-[600px] flex overflow-hidden">
      {/* Sidebar - Conversation List */}
      <div
        className={`${
          activeConversation ? "hidden md:flex" : "flex"
        } w-full md:w-80 flex-col border-r`}
      >
        {/* Header */}
        <div className="p-4 border-b">
          <h2 className="text-lg font-bold mb-3">Messages</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search conversations..."
              onChange={(e) => onSearchConversations?.(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <Send className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No conversations yet</p>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {conversations.map((conv) => (
                <ConversationItem key={conv.id} conv={conv} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`${activeConversation ? "flex" : "hidden md:flex"} flex-1 flex-col`}>
        {activeConversation ? (
          <>
            {/* Chat Header */}
            <div className="flex items-center justify-between p-4 border-b shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => onSelectConversation(null as any)}
                  className="md:hidden p-2 -ml-2 hover:bg-muted rounded-lg"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                {activeConversation.type === "party" ? (
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                ) : (
                  <AvatarWithStatus
                    avatar={activeConversation.participants[0]?.avatar}
                    username={getConversationName(activeConversation)}
                    status={activeConversation.participants[0]?.status || "offline"}
                    size="md"
                  />
                )}
                <div>
                  <h3 className="font-semibold">
                    {getConversationName(activeConversation)}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {activeConversation.type === "party"
                      ? `${activeConversation.participants.length} members`
                      : activeConversation.participants[0]?.status === "online"
                      ? "Online"
                      : activeConversation.participants[0]?.lastSeen || "Offline"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Phone className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Video className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {messages.map((message, index) => {
                const isOwn = message.senderId === currentUser.id;
                const showDate =
                  index === 0 ||
                  new Date(message.timestamp).toDateString() !==
                    new Date(messages[index - 1].timestamp).toDateString();

                return (
                  <div key={message.id} className="space-y-2">
                    {showDate && (
                      <div className="flex items-center justify-center">
                        <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                          {new Date(message.timestamp).toLocaleDateString(undefined, {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                    )}
                    <div
                      className={`group flex items-start gap-1 ${
                        isOwn ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[70%] min-w-0 ${
                          isOwn
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        } rounded-2xl px-4 py-2 break-words overflow-hidden [overflow-wrap:anywhere]`}
                      >
                        {!isOwn && (
                          <span
                            className="block text-xs font-semibold text-primary truncate max-w-full mb-1"
                            data-testid="chat-sender-username"
                          >
                            {(message as any).senderName || (message as any).fromUsername || (activeConversation.type === "party" ? "Party Member" : getConversationName(activeConversation))}
                          </span>
                        )}
                        {!isOwn &&
                          moderationEnabled &&
                          (bannedUserIds.includes(getSenderId(message)) ||
                            mutedUserIds.includes(getSenderId(message))) && (
                            <span
                              className="mb-1 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive"
                              data-testid="moderation-status"
                            >
                              {bannedUserIds.includes(getSenderId(message))
                                ? "Banned"
                                : "Muted"}
                            </span>
                          )}
                        <p className="text-sm break-words [overflow-wrap:anywhere] whitespace-pre-wrap">{message.content}</p>
                        <div
                          className={`flex items-center justify-end gap-1 mt-1 ${
                            isOwn
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground"
                          }`}
                        >
                          <span className="text-[10px]">{formatTime(message.timestamp)}</span>
                          {isOwn && getMessageStatus(message)}
                        </div>
                      </div>

                      {/* Admin moderation menu (issue #890) */}
                      {moderationEnabled && !isOwn && canModerate && (
                        <div className="relative shrink-0 self-center">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenMenuMessageId((cur) =>
                                cur === message.id ? null : message.id
                              )
                            }
                            className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary group-hover:opacity-100"
                            aria-label={`Moderate message from ${getSenderName(message)}`}
                            aria-haspopup="menu"
                            aria-expanded={openMenuMessageId === message.id}
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          </button>

                          {openMenuMessageId === message.id && (
                            <>
                              <div
                                className="fixed inset-0 z-20"
                                aria-hidden="true"
                                onClick={() => setOpenMenuMessageId(null)}
                              />
                              <ul
                                role="menu"
                                aria-label={`Moderation actions for ${getSenderName(message)}`}
                                className="absolute right-0 z-30 mt-1 w-52 overflow-hidden rounded-md border bg-popover p-1 shadow-lg"
                              >
                                {canReport && (
                                  <li role="none">
                                    <button
                                      role="menuitem"
                                      type="button"
                                      onClick={() => handleReport(message)}
                                      className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                                    >
                                      <Flag className="h-4 w-4" aria-hidden="true" />
                                      Report message
                                    </button>
                                  </li>
                                )}
                                {isAdmin && (
                                  <>
                                    <li role="none">
                                      <button
                                        role="menuitem"
                                        type="button"
                                        onClick={() => handleViewHistory(message)}
                                        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                                      >
                                        <History className="h-4 w-4" aria-hidden="true" />
                                        View message history
                                      </button>
                                    </li>
                                    <li
                                      role="separator"
                                      className="my-1 border-t"
                                    />
                                    {MUTE_DURATIONS.map((h) => (
                                      <li role="none" key={h}>
                                        <button
                                          role="menuitem"
                                          type="button"
                                          onClick={() => handleMute(message, h)}
                                          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                                        >
                                          <MicOff className="h-4 w-4" aria-hidden="true" />
                                          Mute for {h === 1 ? "1 hour" : `${h} hours`}
                                        </button>
                                      </li>
                                    ))}
                                    <li role="none">
                                      <button
                                        role="menuitem"
                                        type="button"
                                        onClick={() => handleBan(message)}
                                        className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                                      >
                                        <Ban className="h-4 w-4" aria-hidden="true" />
                                        Ban user
                                      </button>
                                    </li>
                                  </>
                                )}
                              </ul>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" />
                      <span className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.2s]" />
                      <span className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <form
              onSubmit={handleSendMessage}
              className="flex items-center gap-2 p-4 border-t shrink-0"
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0 shrink-0"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  className="w-full px-4 py-2 bg-muted rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0 shrink-0"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              >
                <Smile className="h-5 w-5" />
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                className="h-10 w-10 p-0 shrink-0 rounded-full"
                disabled={!messageInput.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-4">
              <Send className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-xl font-bold mb-2">Your Messages</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Send private messages to friends, create group chats, and stay connected with your party.
            </p>
          </div>
        )}
      </div>

      {/* Message history dialog (issue #890) */}
      {historyUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Message history for ${historyUser.name}`}
        >
          <div
            className="absolute inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => setHistoryUser(null)}
          />
          <div className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border bg-background shadow-xl">
            <div className="flex items-center justify-between border-b p-4">
              <h3 className="font-semibold">
                Message history · {historyUser.name}
              </h3>
              <button
                type="button"
                onClick={() => setHistoryUser(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close message history"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-auto p-4">
              {(() => {
                const history = messages.filter(
                  (m) => getSenderId(m) === historyUser.id
                );
                if (history.length === 0) {
                  return (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No messages from this user in the current conversation.
                    </p>
                  );
                }
                return history.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-md border bg-muted/30 p-2"
                    data-testid="history-message"
                  >
                    <p className="text-sm [overflow-wrap:anywhere]">{m.content}</p>
                    <span className="text-[10px] text-muted-foreground">
                      {getTimestamp(m) ? formatTime(getTimestamp(m)) : ""}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Undo toasts — moderation actions are reversible within the window */}
      {undoStack.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
          {undoStack.map((entry) => (
            <div
              key={entry.id}
              role="status"
              className="flex items-center gap-3 rounded-lg border bg-background px-4 py-2 shadow-lg"
            >
              <span className="text-sm">{entry.label}</span>
              <button
                type="button"
                onClick={() => handleUndo(entry)}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                Undo
              </button>
              <button
                type="button"
                onClick={() => dismissUndo(entry.id)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}