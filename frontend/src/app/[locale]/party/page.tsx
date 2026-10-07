"use client";

import { useEffect, useState } from "react";
import {
  Users,
  Plus,
  MessageCircle,
  Trophy,
  Check,
  X,
  Loader,
} from "lucide-react";
import { PartyManager, PartyInviteNotification } from "@/components/social/PartyManager";
import { PartyChat } from "@/components/social/PartyChat";
import {
  useCreateParty,
  useFriendsList,
  useMyParty,
  usePartyInvites,
  useInviteToParty,
  useKickFromParty,
  useLeaveParty,
  useDisbandParty,
  useSetPartyReady,
  useTogglePartyVoiceChat,
  useAcceptPartyInvite,
  useDeclinePartyInvite,
} from "@/hooks/useSocial";
import { useTournaments } from "@/hooks/useTournaments";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/contexts/NotificationContext";
import { useRouter } from "@/i18n/routing";
import { api } from "@/lib/api";
import type { Party, PartyInvite } from "@/types/social";

export default function PartyPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { notify, addToast } = useNotifications();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [partyName, setPartyName] = useState("");
  const [partyDescription, setPartyDescription] = useState("");
  const [maxMembers, setMaxMembers] = useState(4);
  const [showTournamentModal, setShowTournamentModal] = useState(false);
  const [joiningTournamentId, setJoiningTournamentId] = useState<string | null>(
    null,
  );

  // The party lives on the server; a local copy keeps the UI responsive and
  // lets the flow work even before the full party backend lands.
  const { data: myParty } = useMyParty();
  const { data: friendsData } = useFriendsList();
  const { data: partyInvites, refetch: refetchInvites } = usePartyInvites();
  const { data: tournamentData } = useTournaments();

  const createPartyMutation = useCreateParty();
  const inviteMutation = useInviteToParty();
  const kickMutation = useKickFromParty();
  const leaveMutation = useLeaveParty();
  const disbandMutation = useDisbandParty();
  const readyMutation = useSetPartyReady();
  const voiceChatMutation = useTogglePartyVoiceChat();
  const acceptInviteMutation = useAcceptPartyInvite();
  const declineInviteMutation = useDeclinePartyInvite();

  const [party, setParty] = useState<Party | null>(null);
  const [partyLoading, setPartyLoading] = useState(true);

  useEffect(() => {
    if (myParty) setParty(myParty);
    setPartyLoading(false);
  }, [myParty]);

  const handleCreateParty = async (name: string) => {
    if (!name.trim()) return;
    try {
      const created = await createPartyMutation.mutateAsync({
        name: name.trim(),
        description: partyDescription || undefined,
        maxMembers,
      });
      setParty(created);
      setPartyName("");
      setPartyDescription("");
      setMaxMembers(4);
      setShowCreateForm(false);
      notify({
        type: "match",
        title: "Party Created",
        message: `${created.name} is ready. Invite friends to join!`,
        persistent: true,
        toast: true,
        toastDuration: 4000,
      });
    } catch (error) {
      addToast({
        type: "error",
        title: "Failed to Create Party",
        message: error instanceof Error ? error.message : "Please try again.",
        duration: 5000,
      });
    }
  };

  const handleInviteToParty = async (userId: string) => {
    if (!party) return;
    try {
      await inviteMutation.mutateAsync({ partyId: party.id, userId });
      const friend = friendsData?.friends.find((f) => f.id === userId);
      if (friend) {
        setParty((prev) =>
          prev && !prev.members.some((m) => m.user.id === userId)
            ? {
                ...prev,
                members: [
                  ...prev.members,
                  {
                    user: friend,
                    role: "member",
                    joinedAt: new Date().toISOString(),
                  },
                ],
              }
            : prev,
        );
      }
      addToast({
        type: "success",
        title: "Invitation Sent",
        message: "Your friend will get notified.",
        duration: 3000,
      });
    } catch {
      addToast({
        type: "error",
        title: "Invite Failed",
        message: "Could not send the party invitation.",
        duration: 4000,
      });
    }
  };

  const handleKickFromParty = async (userId: string) => {
    if (!party) return;
    try {
      await kickMutation.mutateAsync({ partyId: party.id, userId });
      setParty((prev) =>
        prev
          ? { ...prev, members: prev.members.filter((m) => m.user.id !== userId) }
          : prev,
      );
    } catch {
      addToast({
        type: "error",
        title: "Kick Failed",
        message: "Could not remove the player from the party.",
        duration: 4000,
      });
    }
  };

  const handleLeaveParty = async () => {
    if (!party) return;
    try {
      await leaveMutation.mutateAsync(party.id);
    } catch {
      // non-fatal — still clear the local party so the UI resets
    }
    setParty(null);
  };

  const handleDisbandParty = async () => {
    if (!party) return;
    try {
      await disbandMutation.mutateAsync(party.id);
    } catch {
      // non-fatal — still clear the local party so the UI resets
    }
    setParty(null);
  };

  const handleSetReady = async (isReady: boolean) => {
    if (!party || !user) return;
    setParty((prev) =>
      prev
        ? {
            ...prev,
            members: prev.members.map((m) =>
              m.user.id === user.id ? { ...m, isReady } : m,
            ),
          }
        : prev,
    );
    try {
      await readyMutation.mutateAsync({ partyId: party.id, isReady });
    } catch {
      // the optimistic toggle is safe to keep; server sync will reconcile
    }
  };

  const handleToggleVoiceChat = async () => {
    if (!party) return;
    setParty((prev) =>
      prev ? { ...prev, voiceChatEnabled: !prev.voiceChatEnabled } : prev,
    );
    try {
      await voiceChatMutation.mutateAsync(party.id);
    } catch {
      // ignore — UI state already reflects the toggle
    }
  };

  const handleStartQueue = () => {
    router.push("/play");
  };

  const handleAcceptInvite = async (invite: PartyInvite) => {
    try {
      const acceptedParty = await acceptInviteMutation.mutateAsync(invite.id);
      setParty(acceptedParty);
      await refetchInvites();
      notify({
        type: "match",
        title: "Party Invite Accepted",
        message: `You joined ${invite.partyName}.`,
        persistent: true,
        toast: true,
        toastDuration: 4000,
      });
    } catch {
      addToast({
        type: "error",
        title: "Invite Failed",
        message: "Could not accept the party invitation.",
        duration: 4000,
      });
    }
  };

  const handleDeclineInvite = async (invite: PartyInvite) => {
    try {
      await declineInviteMutation.mutateAsync(invite.id);
      await refetchInvites();
    } catch {
      // ignore — the row will be cleared on the next refetch
    }
  };

  const handleJoinTournamentAsParty = async (tournamentId: string) => {
    if (!party) return;
    setJoiningTournamentId(tournamentId);
    try {
      const tournament = tournamentData?.find((t) => t.id === tournamentId);
      await api.joinTournament(tournamentId, party.id);
      setShowTournamentModal(false);
      notify({
        type: "match",
        title: "Party Registered",
        message: `${party.name} is registered for ${tournament?.name ?? "the tournament"}.`,
        link: `/tournaments/${tournamentId}`,
        linkLabel: "View Tournament",
        persistent: true,
        toast: true,
        toastDuration: 5000,
      });
    } catch (error) {
      addToast({
        type: "error",
        title: "Registration Failed",
        message:
          error instanceof Error ? error.message : "Could not register the party.",
        duration: 5000,
      });
    } finally {
      setJoiningTournamentId(null);
    }
  };

  const joinableTournaments = (tournamentData ?? []).filter(
    (t) =>
      t.status === "registration_open" &&
      t.currentParticipants < t.maxParticipants,
  );

  const pendingInvites = (partyInvites ?? []).filter(
    (invite) => invite.status === "pending",
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black">
      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-2">
            <Users className="w-8 h-8" />
            Party System
          </h1>
          <p className="text-muted-foreground">
            Create or join a party, chat with teammates, and enter tournaments together.
          </p>
        </div>

        {/* Pending party invites */}
        {pendingInvites.length > 0 && (
          <section aria-label="Party invitations">
            <h2 className="text-lg font-bold text-white mb-3">Party Invitations</h2>
            <div className="space-y-3">
              {pendingInvites.map((invite) => (
                <PartyInviteNotification
                  key={invite.id}
                  inviter={invite.inviter}
                  partyName={invite.partyName}
                  onAccept={() => handleAcceptInvite(invite)}
                  onDecline={() => handleDeclineInvite(invite)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Create Party button + form (shown when no active party) */}
        {!party && !partyLoading && (
          <>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="bg-primary/90 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium flex items-center gap-2 transition-colors"
            >
              <Plus className="w-5 h-5" />
              {showCreateForm ? "Close" : "Create Party"}
            </button>

            {showCreateForm && (
              <div className="bg-surface/50 rounded-lg border border-border p-6 max-w-lg">
                <h2 className="text-xl font-bold text-white mb-4">
                  Create New Party
                </h2>
                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor="party-name-create"
                      className="block text-sm font-medium text-foreground/80 mb-2"
                    >
                      Party Name
                    </label>
                    <input
                      id="party-name-create"
                      type="text"
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                      placeholder="Enter party name..."
                      className="w-full bg-surface-raised border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="party-description"
                      className="block text-sm font-medium text-foreground/80 mb-2"
                    >
                      Description (Optional)
                    </label>
                    <textarea
                      id="party-description"
                      value={partyDescription}
                      onChange={(e) => setPartyDescription(e.target.value)}
                      placeholder="Enter party description..."
                      className="w-full bg-surface-raised border border-gray-600 rounded-lg px-4 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-primary h-20 resize-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="max-members"
                      className="block text-sm font-medium text-foreground/80 mb-2"
                    >
                      Max Members: {maxMembers}
                    </label>
                    <input
                      id="max-members"
                      type="range"
                      min="2"
                      max="8"
                      value={maxMembers}
                      onChange={(e) => setMaxMembers(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <div className="flex gap-4">
                    <button
                      onClick={() => handleCreateParty(partyName)}
                      disabled={createPartyMutation.isPending || !partyName.trim()}
                      className="flex-1 bg-primary/90 hover:bg-blue-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                      {createPartyMutation.isPending ? "Creating..." : "Create Party"}
                    </button>
                    <button
                      onClick={() => setShowCreateForm(false)}
                      className="flex-1 bg-surface-raised hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Party manager */}
        <PartyManager
          party={party}
          allFriends={friendsData?.friends || []}
          onCreateParty={(name) => handleCreateParty(name)}
          onDisbandParty={handleDisbandParty}
          onInviteToParty={handleInviteToParty}
          onKickFromParty={handleKickFromParty}
          onSetReady={handleSetReady}
          onToggleVoiceChat={handleToggleVoiceChat}
          onStartQueue={handleStartQueue}
        />

        {/* Party utilities: chat + tournament entry */}
        {party && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PartyChat partyId={party.id} />

            <div className="flex flex-col rounded-xl border border-white/15 bg-white/5 backdrop-blur-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-white">
                  Tournament Entry
                </h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Register your whole party into an open tournament at once.
              </p>
              <button
                onClick={() => setShowTournamentModal(true)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary/90 hover:bg-primary text-white px-4 py-2.5 text-sm font-semibold transition-colors"
              >
                <Trophy className="h-4 w-4" />
                Join Tournament with Party
              </button>

              {!party.voiceChatEnabled && (
                <p className="mt-4 text-xs text-muted-foreground flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  Voice chat is off — members can still use party chat above.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Tournament picker modal */}
        {showTournamentModal && party && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-lg border border-border shadow-lg w-full max-w-md max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b">
                <h2 className="font-semibold text-foreground">
                  Join Tournament as {party.name}
                </h2>
                <button
                  onClick={() => setShowTournamentModal(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Close tournament picker"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto space-y-2">
                {joinableTournaments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">
                    No tournaments are open for registration right now.
                  </p>
                ) : (
                  joinableTournaments.map((tournament) => {
                    const isJoining = joiningTournamentId === tournament.id;
                    return (
                      <div
                        key={tournament.id}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/40 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {tournament.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {tournament.gameType} ·{" "}
                            {tournament.entryFee === 0
                              ? "Free"
                              : `$${tournament.entryFee}`}{" "}
                            entry · {tournament.currentParticipants}/
                            {tournament.maxParticipants} players
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            handleJoinTournamentAsParty(tournament.id)
                          }
                          disabled={isJoining}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary/90 hover:bg-primary disabled:opacity-50 text-white px-3 py-1.5 text-sm font-medium transition-colors"
                        >
                          {isJoining ? (
                            <>
                              <Loader className="h-3.5 w-3.5 animate-spin" />
                              Joining…
                            </>
                          ) : (
                            <>
                              <Check className="h-3.5 w-3.5" />
                              Join
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}