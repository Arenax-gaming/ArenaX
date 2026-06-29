"use client";

import React, { useState } from "react";
import { MessageSquare } from "lucide-react";
import { ChatInterface } from "@/components/social/ChatInterface";
import { useConversations, useSendMessage } from "@/hooks/useSocial";
import { useAuth } from "@/hooks/useAuth";
import { AvatarSkeleton, Skeleton } from "@/components/common/PageSkeleton";

export default function MessagesPage() {
  const { user } = useAuth();
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [messageContent, setMessageContent] = useState("");

  const { data: conversations, isLoading: conversationsLoading } =
    useConversations();
  const sendMessageMutation = useSendMessage();

  const selectedConversation = conversations?.find(
    (c) => c.id === selectedConversationId,
  );

  const handleSendMessage = async () => {
    if (!selectedConversation || !messageContent.trim()) return;

    try {
      await sendMessageMutation.mutateAsync({
        toUserId: selectedConversation.participantId,
        content: messageContent,
      });
      setMessageContent("");
    } catch (error) {
      console.error("Failed to send message:", error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-2">
            <MessageSquare className="w-8 h-8" />
            Messages
          </h1>
          <p className="text-muted-foreground">
            Chat with friends and party members in real-time
          </p>
        </div>

        {/* Chat Interface */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px]">
          {/* Conversations List */}
          <div className="bg-surface/50 rounded-lg border border-border overflow-hidden flex flex-col">
            <div className="p-4 border-b border-border">
              <h2 className="text-lg font-bold text-white">Conversations</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              {conversationsLoading ? (
                <div className="divide-y divide-border/50" aria-label="Loading conversations" aria-live="polite">
                  <span className="sr-only">Loading conversations…</span>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-4">
                      <AvatarSkeleton size="md" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-40" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : conversations && conversations.length > 0 ? (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedConversationId(conv.id)}
                    className={`w-full p-4 border-b border-border text-left transition-colors ${
                      selectedConversationId === conv.id
                        ? "bg-primary/90/20 border-l-2 border-l-blue-500"
                        : "hover:bg-surface-raised/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-white truncate">
                          {conv.participantUsername}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {conv.lastMessage}
                        </p>
                      </div>
                      {conv.unreadCount > 0 && (
                        <span className="ml-2 bg-primary/90 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No conversations yet
                </div>
              )}
            </div>
          </div>

          {/* Chat Area */}
          <div className="md:col-span-2 bg-surface/50 rounded-lg border border-border overflow-hidden flex flex-col">
            {selectedConversation ? (
              <>
                {/* Chat Header */}
                <div className="p-4 border-b border-border">
                  <h3 className="text-lg font-bold text-white">
                    {selectedConversation.participantUsername}
                  </h3>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="text-center text-muted-foreground text-sm">
                    Start of conversation with{" "}
                    {selectedConversation.participantUsername}
                  </div>
                </div>

                {/* Message Input */}
                <div className="p-4 border-t border-border">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Type a message..."
                      value={messageContent}
                      onChange={(e) => setMessageContent(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === "Enter") handleSendMessage();
                      }}
                      className="flex-1 bg-surface-raised border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-primary"
                    />
                    <button
                      onClick={handleSendMessage}
                      disabled={
                        sendMessageMutation.isPending || !messageContent.trim()
                      }
                      className="bg-primary/90 hover:bg-blue-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Select a conversation to start messaging
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
