"use client";

import { useState } from "react";
import { UserPlus, Users, Search, Bell, Settings } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { useSocial } from "@/hooks/useSocial";
import {
  FriendsList,
  FriendRequests,
  InviteFriends,
  AvatarWithStatus,
  StatusSelector,
} from "@/components/social";
import { currentUser } from "@/data/user";
import type { UserStatus } from "@/types/social";

export default function FriendsPage() {
  const {
    friends,
    friendRequests,
    searchQuery,
    setSearchQuery,
    filteredFriends,
    onlineFriends,
    acceptFriendRequest,
    declineFriendRequest,
    removeFriend,
    sendFriendRequest,
    userStatus,
    setStatus,
    getAllUsers,
  } = useSocial();

  const [activeTab, setActiveTab] = useState<"list" | "requests" | "invite">("list");
  const [showInviteModal, setShowInviteModal] = useState(false);

  const handleSendMessage = (friendId: string) => {
    // Navigate to messages page with friend selected
    window.location.href = `/messages?friend=${friendId}`;
  };

  const handleInviteToParty = (friendId: string) => {
    // Navigate to party page and invite
    window.location.href = `/party?invite=${friendId}`;
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Friends</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your friends list and connect with other players
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
            <span className="text-sm font-medium">Status:</span>
            <StatusSelector
              currentStatus={userStatus}
              onStatusChange={setStatus}
            />
          </div>
          <Button variant="primary" onClick={() => setShowInviteModal(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Invite Friends
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{friends.length}</div>
                <div className="text-xs text-muted-foreground">Total Friends</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <div className="h-5 w-5 rounded-full bg-green-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{onlineFriends.length}</div>
                <div className="text-xs text-muted-foreground">Online Now</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <Bell className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{friendRequests.length}</div>
                <div className="text-xs text-muted-foreground">Pending Requests</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                <Users className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {friends.filter(f => f.isFavorite).length}
                </div>
                <div className="text-xs text-muted-foreground">Favorites</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Friends List */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs */}
          <div className="flex border-b">
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "list"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("list")}
            >
              Friends List
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "requests"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("requests")}
            >
              Friend Requests
              {friendRequests.length > 0 && (
                <span className="ml-2 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 bg-primary text-primary-foreground text-xs font-bold rounded-full">
                  {friendRequests.length}
                </span>
              )}
            </button>
            <button
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === "invite"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab("invite")}
            >
              Find Friends
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === "list" && (
            <FriendsList
              friends={filteredFriends}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onRemoveFriend={removeFriend}
              onSendMessage={handleSendMessage}
              onInviteToParty={handleInviteToParty}
            />
          )}

          {activeTab === "requests" && (
            <FriendRequests
              requests={friendRequests}
              onAccept={acceptFriendRequest}
              onDecline={declineFriendRequest}
            />
          )}

          {activeTab === "invite" && (
            <InviteFriends
              friends={friends}
              allUsers={getAllUsers()}
              onInviteFriend={(userId) => {
                sendFriendRequest(
                  getAllUsers().find(u => u.id === userId)!,
                  "Hey! Let's connect on ArenaX!"
                );
              }}
            />
          )}
        </div>

        {/* Right Column - Sidebar */}
        <div className="space-y-6">
          {/* Your Profile Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Your Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 mb-4">
                <AvatarWithStatus
                  avatar={currentUser.avatar}
                  username={currentUser.username}
                  status={userStatus}
                  size="lg"
                />
                <div>
                  <div className="font-semibold">{currentUser.username}</div>
                  <div className="text-sm text-muted-foreground">ELO {currentUser.elo}</div>
                  <div className="text-xs text-muted-foreground">
                    {userStatus === "online"
                      ? "Online"
                      : userStatus === "in-game"
                      ? "In Game"
                      : userStatus === "away"
                      ? "Away"
                      : userStatus === "busy"
                      ? "Busy"
                      : "Offline"}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Privacy</span>
                  <Button variant="ghost" size="sm" className="h-7">
                    <Settings className="h-4 w-4 mr-1" />
                    Settings
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Online Friends Quick List */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center justify-between">
                <span>Online Friends</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {onlineFriends.length} active
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {onlineFriends.slice(0, 5).map((friend) => (
                  <div
                    key={friend.id}
                    className="flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <AvatarWithStatus
                      avatar={friend.avatar}
                      username={friend.username}
                      status={friend.status}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {friend.username}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {friend.currentActivity || friend.status}
                      </div>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">
                      {friend.elo}
                    </span>
                  </div>
                ))}
                {onlineFriends.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No friends online right now
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md">
            <InviteFriends
              friends={friends}
              allUsers={getAllUsers()}
              onInviteFriend={(userId) => {
                sendFriendRequest(
                  getAllUsers().find(u => u.id === userId)!,
                  "Hey! Let's connect on ArenaX!"
                );
              }}
            />
            <Button
              variant="ghost"
              className="w-full mt-4"
              onClick={() => setShowInviteModal(false)}
            >
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}