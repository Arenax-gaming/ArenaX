"use client";

import { useState } from "react";
import {
  Users,
  UserPlus,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Settings,
  Play,
  X,
  Crown,
  Check,
  Loader,
  Gamepad2,
  MapPin,
  Lock,
  Unlock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AvatarWithStatus } from "./OnlineStatus";
import type { Party, PartyMember, SocialUser } from "@/types/social";

interface PartyManagerProps {
  party: Party | null;
  allFriends: SocialUser[];
  onCreateParty: (name: string, isPrivate: boolean) => void;
  onDisbandParty: () => void;
  onInviteToParty: (userId: string) => void;
  onKickFromParty: (userId: string) => void;
  onSetReady: (isReady: boolean) => void;
  onToggleVoiceChat: () => void;
  onStartQueue: () => void;
  isQueueing?: boolean;
}

export function PartyManager({
  party,
  allFriends,
  onCreateParty,
  onDisbandParty,
  onInviteToParty,
  onKickFromParty,
  onSetReady,
  onToggleVoiceChat,
  onStartQueue,
  isQueueing = false,
}: PartyManagerProps) {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [partyName, setPartyName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);

  if (!party) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-xl font-black flex items-center gap-2">
            <Gamepad2 className="h-6 w-6" />
            Party
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center mb-4">
              <Users className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No Party</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Create a party to play with friends, share voice chat, and queue up together.
            </p>
            <Button
              variant="primary"
              onClick={() => setShowCreateModal(true)}
            >
              <Users className="h-4 w-4 mr-2" />
              Create Party
            </Button>
          </div>

          {/* Create Party Modal */}
          {showCreateModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <Card className="w-full max-w-md">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Create Party</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => setShowCreateModal(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Party Name</label>
                    <input
                      type="text"
                      placeholder="Enter party name..."
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-medium">Private Party</label>
                      <p className="text-xs text-muted-foreground">
                        Only invited players can join
                      </p>
                    </div>
                    <button
                      onClick={() => setIsPrivate(!isPrivate)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        isPrivate ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition-transform ${
                          isPrivate ? "translate-x-5" : ""
                        }`}
                      />
                    </button>
                  </div>
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                      if (partyName.trim()) {
                        onCreateParty(partyName.trim(), isPrivate);
                        setPartyName("");
                        setIsPrivate(false);
                        setShowCreateModal(false);
                      }
                    }}
                    disabled={!partyName.trim()}
                  >
                    Create Party
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const isLeader = party.leaderId === "user-123";
  const currentMember = party.members.find(m => m.user.id === "user-123");
  const allReady = party.members.every(m => m.isReady) && party.members.length > 1;

  // Invite Modal
  const InviteModal = () => (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invite to Party</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setShowInviteModal(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {allFriends
              .filter(f => !party.members.find(m => m.user.id === f.id))
              .map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/40 transition-colors"
                >
                  <AvatarWithStatus
                    avatar={friend.avatar}
                    username={friend.username}
                    status={friend.status}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{friend.username}</span>
                    <span className="text-xs text-muted-foreground block">
                      ELO {friend.elo} · {friend.status}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onInviteToParty(friend.id);
                    }}
                  >
                    Invite
                  </Button>
                </div>
              ))}
            {allFriends.filter(f => !party.members.find(m => m.user.id === f.id)).length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                No friends available to invite
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl font-black flex items-center gap-2">
              <Gamepad2 className="h-6 w-6" />
              {party.name}
            </CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {party.region}
              </span>
              {party.isPrivate && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  Private
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {party.members.length}/{party.maxMembers} players
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {isLeader && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setShowInviteModal(true)}
                >
                  <UserPlus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={onDisbandParty}
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Members List */}
        <div className="space-y-2">
          {party.members.map((member) => {
            const isCurrentMember = member.user.id === "user-123";
            const isMemberLeader = member.role === "leader";

            return (
              <div
                key={member.user.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/30"
              >
                <div className="relative">
                  <AvatarWithStatus
                    avatar={member.user.avatar}
                    username={member.user.username}
                    status={member.user.status}
                    size="md"
                  />
                  {member.isSpeaking && (
                    <div className="absolute -bottom-1 -right-1 h-4 w-4 bg-green-500 rounded-full flex items-center justify-center">
                      <Volume2 className="h-2 w-2 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{member.user.username}</span>
                    {isMemberLeader && (
                      <Crown className="h-4 w-4 text-yellow-500" />
                    )}
                    {member.isReady && (
                      <Check className="h-4 w-4 text-green-500" />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {member.user.currentActivity || member.user.status}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {member.user.status === "in-game" && (
                    <span className="text-xs bg-yellow-500/20 text-yellow-600 px-2 py-0.5 rounded-full">
                      In Game
                    </span>
                  )}
                  {!isCurrentMember && isLeader && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => onKickFromParty(member.user.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Voice Chat Controls */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2">
            {party.voiceChatEnabled ? (
              <Mic className="h-5 w-5 text-green-500" />
            ) : (
              <MicOff className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">
              Voice Chat {party.voiceChatEnabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={onToggleVoiceChat}
          >
            {party.voiceChatEnabled ? (
              <MicOff className="h-4 w-4 mr-1" />
            ) : (
              <Mic className="h-4 w-4 mr-1" />
            )}
            {party.voiceChatEnabled ? "Disable" : "Enable"}
          </Button>
        </div>

        {/* Ready & Queue Controls */}
        <div className="flex items-center gap-3">
          {!currentMember?.isReady ? (
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => onSetReady(true)}
            >
              <Check className="h-4 w-4 mr-2" />
              Ready Up
            </Button>
          ) : (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onSetReady(false)}
            >
              Not Ready
            </Button>
          )}
          {isLeader && allReady && (
            <Button
              variant="primary"
              className="flex-1"
              onClick={onStartQueue}
              disabled={isQueueing}
            >
              {isQueueing ? (
                <>
                  <Loader className="h-4 w-4 mr-2 animate-spin" />
                  Queueing...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Start Queue
                </>
              )}
            </Button>
          )}
        </div>

        {/* Invite Modal */}
        {showInviteModal && <InviteModal />}
      </CardContent>
    </Card>
  );
}

// Party invite notification component
interface PartyInviteNotificationProps {
  inviter: SocialUser;
  partyName: string;
  onAccept: () => void;
  onDecline: () => void;
}

export function PartyInviteNotification({
  inviter,
  partyName,
  onAccept,
  onDecline,
}: PartyInviteNotificationProps) {
  return (
    <Card className="border-primary/20">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <AvatarWithStatus
            avatar={inviter.avatar}
            username={inviter.username}
            status={inviter.status}
            size="md"
          />
          <div className="flex-1">
            <p className="text-sm">
              <span className="font-medium">{inviter.username}</span>{" "}
              invited you to join{" "}
              <span className="font-medium">{partyName}</span>
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Button variant="primary" size="sm" onClick={onAccept}>
                Accept
              </Button>
              <Button variant="outline" size="sm" onClick={onDecline}>
                Decline
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}