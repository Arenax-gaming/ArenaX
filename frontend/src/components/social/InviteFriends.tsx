"use client";

import { useState } from "react";
import { Search, UserPlus, X, Check, Copy, Share2, Link as LinkIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AvatarWithStatus } from "./OnlineStatus";
import type { Friend, SocialUser } from "@/types/social";

interface InviteFriendsProps {
  friends: Friend[];
  allUsers: SocialUser[];
  onInviteFriend: (userId: string) => void;
  onInviteByEmail?: (email: string) => void;
}

export function InviteFriends({
  friends,
  allUsers,
  onInviteFriend,
  onInviteByEmail,
}: InviteFriendsProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [inviteTab, setInviteTab] = useState<"friends" | "link" | "email">("friends");
  const [emailInput, setEmailInput] = useState("");
  const [copied, setCopied] = useState(false);

  // Get users who are not already friends
  const friendIds = new Set(friends.map(f => f.id));
  const suggestedUsers = allUsers.filter(u => !friendIds.has(u.id));

  const filteredSuggestions = suggestedUsers.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const inviteLink = typeof window !== "undefined"
    ? `${window.location.origin}/invite?ref=${encodeURIComponent("ProGamer99")}`
    : "";

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleEmailInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (emailInput && onInviteByEmail) {
      onInviteByEmail(emailInput);
      setEmailInput("");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-xl font-black">Invite Friends</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Tab Navigation */}
        <div className="flex border-b mb-4">
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              inviteTab === "friends"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setInviteTab("friends")}
          >
            Find Friends
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              inviteTab === "link"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setInviteTab("link")}
          >
            Invite Link
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              inviteTab === "email"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setInviteTab("email")}
          >
            Email
          </button>
        </div>

        {/* Friends Tab */}
        {inviteTab === "friends" && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2 max-h-[400px] overflow-auto">
              {filteredSuggestions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p className="text-sm">No users found</p>
                </div>
              ) : (
                filteredSuggestions.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/40 transition-colors"
                  >
                    <AvatarWithStatus
                      avatar={user.avatar}
                      username={user.username}
                      status={user.status}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{user.username}</span>
                        <span className="text-xs font-mono text-muted-foreground">
                          ELO {user.elo}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {user.currentActivity || user.status}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => onInviteFriend(user.id)}
                    >
                      <UserPlus className="h-4 w-4 mr-1" />
                      Invite
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Invite Link Tab */}
        {inviteTab === "link" && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <LinkIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Share Your Invite Link</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Share this link with friends to invite them to ArenaX
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteLink}
                className="flex-1 px-3 py-2 bg-muted rounded-md text-sm font-mono truncate"
              />
              <Button
                variant={copied ? "primary" : "outline"}
                onClick={handleCopyLink}
                className="shrink-0"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-1" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-1" />
                    Copy
                  </>
                )}
              </Button>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" size="sm">
                <Share2 className="h-4 w-4 mr-2" />
                Share
              </Button>
            </div>

            <div className="bg-muted rounded-lg p-4 mt-4">
              <h4 className="text-sm font-semibold mb-2">Benefits of inviting friends:</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Play together in parties</li>
                <li>• Earn bonus rewards</li>
                <li>• Track each other&apos;s progress</li>
                <li>• Compete on friend leaderboards</li>
              </ul>
            </div>
          </div>
        )}

        {/* Email Tab */}
        {inviteTab === "email" && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <svg
                  className="h-8 w-8 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Invite via Email</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Send an invitation directly to your friend&apos;s email
              </p>
            </div>

            {onInviteByEmail ? (
              <form onSubmit={handleEmailInvite} className="space-y-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Email Address</label>
                  <input
                    type="email"
                    placeholder="friend@example.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    className="w-full px-3 py-2 bg-muted rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <Button type="submit" variant="primary" className="w-full">
                  Send Invitation
                </Button>
              </form>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                Email invitations are not available at the moment.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Quick invite button for use in other components
interface QuickInviteButtonProps {
  userId: string;
  username: string;
  onInvite: (userId: string) => void;
  isPending?: boolean;
}

export function QuickInviteButton({
  userId,
  username,
  onInvite,
  isPending = false,
}: QuickInviteButtonProps) {
  const [invited, setInvited] = useState(false);

  const handleClick = () => {
    if (!invited && !isPending) {
      onInvite(userId);
      setInvited(true);
      setTimeout(() => setInvited(false), 3000);
    }
  };

  if (invited) {
    return (
      <Button variant="outline" size="sm" className="h-8 text-green-600" disabled>
        <Check className="h-4 w-4 mr-1" />
        Invited
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? (
        <>
          <svg className="animate-spin h-4 w-4 mr-1" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Sending...
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4 mr-1" />
          Invite {username}
        </>
      )}
    </Button>
  );
}