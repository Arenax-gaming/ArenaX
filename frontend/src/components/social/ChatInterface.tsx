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
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AvatarWithStatus } from "./OnlineStatus";
import type { Conversation, Message, SocialUser } from "@/types/social";

interface ChatInterfaceProps {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Message[];
  isTyping: boolean;
  currentUser: SocialUser;
  onSelectConversation: (conversation: Conversation) => void;
  onSendMessage: (content: string) => void;
  onSearchConversations?: (query: string) => void;
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
}: ChatInterfaceProps) {
  const [messageInput, setMessageInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
        return <CheckCheck className="h-4 w-4 text-blue-500" />;
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
              className="w-full pl-9 pr-4 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                      className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[70%] ${
                          isOwn
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted"
                        } rounded-2xl px-4 py-2`}
                      >
                        <p className="text-sm">{message.content}</p>
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
                  className="w-full px-4 py-2 bg-muted rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
    </Card>
  );
}