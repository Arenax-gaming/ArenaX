"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Gamepad2, Users, Mic, Trophy, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useSocial } from "@/hooks/useSocial";
import { PartyManager, AvatarWithStatus } from "@/components/social";
import { currentUser } from "@/data/user";

function PartyContent() {
  const searchParams = useSearchParams();
  const inviteParam = searchParams.get("invite");

  const {
    party,
    friends,
    partyInvites,
    createParty,
    disbandParty,
    inviteToParty,
    kickFromParty,
    setReady,
    toggleVoiceChat,
  } = useSocial();

  const [isQueueing, setIsQueueing] = useState(false);

  // Auto-invite from URL parameter
  useEffect(() => {
    if (inviteParam) {
      inviteToParty(inviteParam);
    }
  }, [inviteParam, inviteToParty]);

  const handleStartQueue = () => {
    setIsQueueing(true);
    // Simulate queue start
    setTimeout(() => setIsQueueing(false), 3000);
  };

  const currentParty = party;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
            <Gamepad2 className="h-8 w-8" />
            Party
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Team up with friends and dominate the competition
          </p>
        </div>
        {!currentParty && (
          <Button variant="primary" onClick={() => createParty("My Squad", false)}>
            <Users className="h-4 w-4 mr-2" />
            Quick Create
          </Button>
        )}
      </div>

      {/* Party Invites */}
      {partyInvites.length > 0 && !currentParty && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Pending Invitations</h2>
          {partyInvites.map((invite) => (
            <Card key={invite.id} className="border-primary/30">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AvatarWithStatus
                      avatar={invite.inviter.avatar}
                      username={invite.inviter.username}
                      status={invite.inviter.status}
                      size="md"
                    />
                    <div>
                      <p className="text-sm">
                        <span className="font-medium">{invite.inviter.username}</span>{" "}
                        invited you to join{" "}
                        <span className="font-medium text-primary">{invite.partyName}</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(invite.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="primary" size="sm">Accept</Button>
                    <Button variant="outline" size="sm">Decline</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Party Manager */}
        <div className="lg:col-span-2">
          <PartyManager
            party={currentParty}
            allFriends={friends}
            onCreateParty={createParty}
            onDisbandParty={disbandParty}
            onInviteToParty={inviteToParty}
            onKickFromParty={kickFromParty}
            onSetReady={setReady}
            onToggleVoiceChat={toggleVoiceChat}
            onStartQueue={handleStartQueue}
            isQueueing={isQueueing}
          />
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" size="sm">
                <Users className="h-4 w-4 mr-2" />
                Find Teammates
              </Button>
              <Button variant="outline" className="w-full justify-start" size="sm">
                <Globe className="h-4 w-4 mr-2" />
                Browse Parties
              </Button>
              <Button variant="outline" className="w-full justify-start" size="sm">
                <Trophy className="h-4 w-4 mr-2" />
                Tournament Mode
              </Button>
            </CardContent>
          </Card>

          {/* Voice Chat Info */}
          {currentParty && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Mic className="h-4 w-4" />
                  Voice Chat
                </CardTitle>
              </CardHeader>
              <CardContent>
                {currentParty.voiceChatEnabled ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                      Connected
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <p>Region: {currentParty.region}</p>
                      <p>Members: {currentParty.members.length}</p>
                    </div>
                    <Button variant="outline" size="sm" className="w-full">
                      <Mic className="h-4 w-4 mr-2" />
                      Mute Mic
                    </Button>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <Mic className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Voice chat disabled</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={toggleVoiceChat}
                    >
                      Enable Voice Chat
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Friends Online */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                Friends Online ({friends.filter(f => f.status !== "offline").length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y max-h-[300px] overflow-auto">
                {friends
                  .filter(f => f.status !== "offline")
                  .slice(0, 6)
                  .map((friend) => {
                    const isInParty = currentParty?.members.some(
                      m => m.user.id === friend.id
                    );
                    return (
                      <div
                        key={friend.id}
                        className="flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors"
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
                        {isInParty ? (
                          <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                            In Party
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => inviteToParty(friend.id)}
                          >
                            Invite
                          </Button>
                        )}
                      </div>
                    );
                  })}
                {friends.filter(f => f.status !== "offline").length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No friends online
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Party Tips */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Party Tips</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-2">
                <li>• All party members must be ready to queue</li>
                <li>• Voice chat helps coordinate strategies</li>
                <li>• Party leader controls queue settings</li>
                <li>• Maximum party size is 5 players</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Wrap the content in Suspense for useSearchParams
export default function PartyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      }
    >
      <PartyContent />
    </Suspense>
  );
}