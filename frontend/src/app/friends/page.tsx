"use client";

import React, { useState } from "react";
import { UserPlus, Users, Search, MessageSquare } from "lucide-react";
import { FriendsList } from "@/components/social/FriendsList";
import { FriendRequests } from "@/components/social/FriendRequests";
import { InviteFriends } from "@/components/social/InviteFriends";
import { useFriendsList, usePendingFriendRequests } from "@/hooks/useSocial";

export default function FriendsPage() {
  const [activeTab, setActiveTab] = useState<"list" | "requests" | "invite">(
    "list",
  );
  const [searchQuery, setSearchQuery] = useState("");

  const { data: friendsData, isLoading: friendsLoading } = useFriendsList();
  const { data: requestsData, isLoading: requestsLoading } =
    usePendingFriendRequests();

  const friends = friendsData?.friends || [];
  const filteredFriends = friends.filter((f) =>
    f.username.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const onlineFriends = friends.filter((f) => f.isOnline).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-2">
            <Users className="w-8 h-8" />
            Friends
          </h1>
          <p className="text-gray-400">
            {onlineFriends} of {friends.length} friends online
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8 border-b border-gray-700">
          <button
            onClick={() => setActiveTab("list")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "list"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-gray-400 hover:text-gray-300"
            }`}
          >
            <Users className="w-4 h-4 inline mr-2" />
            Friends ({friends.length})
          </button>
          <button
            onClick={() => setActiveTab("requests")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "requests"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-gray-400 hover:text-gray-300"
            }`}
          >
            <UserPlus className="w-4 h-4 inline mr-2" />
            Requests ({requestsData?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab("invite")}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === "invite"
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-gray-400 hover:text-gray-300"
            }`}
          >
            <UserPlus className="w-4 h-4 inline mr-2" />
            Add Friends
          </button>
        </div>

        {/* Search Bar */}
        {activeTab === "list" && (
          <div className="mb-6 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {/* Content */}
        <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-6">
          {activeTab === "list" && (
            <FriendsList
              friends={filteredFriends}
              isLoading={friendsLoading}
              onMessage={(friendId) => {
                window.location.href = `/messages?friend=${friendId}`;
              }}
            />
          )}

          {activeTab === "requests" && (
            <FriendRequests
              requests={requestsData || []}
              isLoading={requestsLoading}
            />
          )}

          {activeTab === "invite" && <InviteFriends />}
        </div>
      </div>
    </div>
  );
}
