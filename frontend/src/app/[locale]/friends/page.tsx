"use client";

import React, { useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { FriendsList } from "@/components/social/FriendsList";
import { FriendRequests } from "@/components/social/FriendRequests";
import { InviteFriends } from "@/components/social/InviteFriends";
import {
  useFriendsList,
  usePendingFriendRequests,
  useAcceptFriendRequest,
} from "@/hooks/useSocial";

export default function FriendsPage() {
  const [activeTab, setActiveTab] = useState<"list" | "requests" | "invite">(
    "list",
  );
  const [searchQuery, setSearchQuery] = useState("");

  const { data: friendsData } = useFriendsList();
  const { data: requestsData } = usePendingFriendRequests();

  // Wired to the existing /friends/requests/accept endpoint.
  const acceptRequest = useAcceptFriendRequest();

  const friends = friendsData?.friends || [];
  const onlineFriends = friends.filter(
    (f) => f.status === "online" || f.status === "in-game",
  ).length;

  // Stubs for actions the backend doesn't yet expose. Logging keeps them
  // dev-visible; in production the branches are stripped at build time.
  const handleRemoveFriend = (friendId: string) => {
    // TODO: replace with useRemoveFriend mutation once /friends/remove lands.
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.warn(
        "[FriendsPage] Remove friend requested but backend endpoint isn't wired up yet:",
        friendId,
      );
    }
  };

  const handleInviteToParty = (friendId: string) => {
    // Use the existing party creation flow; /party/new reads ?invite=<id>.
    window.location.href = `/party/new?invite=${friendId}`;
  };

  const handleAcceptRequest = (requestId: string) => {
    acceptRequest.mutate(requestId);
  };

  const handleDeclineRequest = (requestId: string) => {
    // TODO: replace with useDeclineFriendRequest mutation once
    // /friends/requests/decline lands.
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.warn(
        "[FriendsPage] Decline friend request requested but backend endpoint isn't wired up yet:",
        requestId,
      );
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-2">
            <Users className="w-8 h-8" />
            Friends
          </h1>
          <p className="text-muted-foreground">
            {onlineFriends} of {friends.length} friends online
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8 border-b border-border">
          <button
            onClick={() => setActiveTab("list")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "list"
                ? "text-primary/80 border-b-2 border-primary/70"
                : "text-muted-foreground hover:text-foreground/80"
            }`}
          >
            <Users className="w-4 h-4 inline mr-2" />
            Friends ({friends.length})
          </button>
          <button
            onClick={() => setActiveTab("requests")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "requests"
                ? "text-primary/80 border-b-2 border-primary/70"
                : "text-muted-foreground hover:text-foreground/80"
            }`}
          >
            <UserPlus className="w-4 h-4 inline mr-2" />
            Requests ({requestsData?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("invite")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "invite"
                ? "text-primary/80 border-b-2 border-primary/70"
                : "text-muted-foreground hover:text-foreground/80"
            }`}
          >
            <UserPlus className="w-4 h-4 inline mr-2" />
            Add Friends
          </button>
        </div>

        {/* Content */}
        <div className="bg-surface/50 rounded-lg border border-border p-6">
          {activeTab === "list" && (
            <FriendsList
              friends={friends}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onRemoveFriend={handleRemoveFriend}
              onSendMessage={(friendId) => {
                window.location.href = `/messages?friend=${friendId}`;
              }}
              onInviteToParty={handleInviteToParty}
            />
          )}

          {activeTab === "requests" && (
            <FriendRequests
              requests={requestsData || []}
              onAccept={handleAcceptRequest}
              onDecline={handleDeclineRequest}
            />
          )}

          {activeTab === "invite" && <InviteFriends />}
        </div>
      </div>
    </div>
  );
}
