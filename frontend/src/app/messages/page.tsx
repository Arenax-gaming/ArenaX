"use client";

import { useSocial } from "@/hooks/useSocial";
import { ChatInterface } from "@/components/social";
import { currentUser } from "@/data/user";

export default function MessagesPage() {
  const {
    conversations,
    activeConversation,
    messages,
    isTyping,
    selectConversation,
    sendMessage,
  } = useSocial();

  const currentSocialUser = {
    id: currentUser.id,
    username: currentUser.username,
    avatar: currentUser.avatar,
    elo: currentUser.elo,
    status: "online" as const,
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black tracking-tight">Messages</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Chat with friends and party members in real-time
        </p>
      </div>

      {/* Chat Interface */}
      <ChatInterface
        conversations={conversations}
        activeConversation={activeConversation}
        messages={messages}
        isTyping={isTyping}
        currentUser={currentSocialUser}
        onSelectConversation={selectConversation}
        onSendMessage={sendMessage}
      />
    </div>
  );
}