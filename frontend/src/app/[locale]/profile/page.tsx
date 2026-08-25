"use client";

import React, { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import { EloChart } from "@/components/profile/EloChart";
import { MatchHistory } from "@/components/profile/MatchHistory";
import { ProfileBio } from "@/components/profile/ProfileBio";
import { ReputationBadge } from "@/components/profile/ReputationBadge";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { Button } from "@/components/ui/Button";
import { useAuth, AUTH_PROFILE_QUERY_KEY } from "@/hooks/useAuth";
import { useMatches } from "@/hooks/useMatches";
import { useNotifications } from "@/contexts/NotificationContext";
import { api } from "@/lib/api";
import { User, EloPoint } from "@/types/user";

// Skeleton for loading state
function ProfileSkeleton() {
  return (
    <div className="py-4 max-w-[100vw] overflow-hidden mx-auto space-y-8 animate-pulse">
      <div className="flex flex-col md:flex-row gap-8 items-start md:items-center bg-card border rounded-xl p-8 shadow-sm">
        <div className="h-32 w-32 rounded-full bg-muted" />
        <div className="flex-1 space-y-3">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-4 bg-muted rounded w-64" />
          <div className="flex gap-4 mt-4">
            <div className="h-16 w-24 bg-muted rounded-lg" />
            <div className="h-16 w-24 bg-muted rounded-lg" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="h-64 bg-muted rounded-xl" />
          <div className="h-48 bg-muted rounded-xl" />
        </div>
        <div className="h-96 bg-muted rounded-xl" />
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user: authUser, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { notify } = useNotifications();

  // Local draft state for editing
  const [isEditing, setIsEditing] = useState(false);
  const [draftUsername, setDraftUsername] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);

  // Sync draft when auth user loads
  useEffect(() => {
    if (authUser) {
      setDraftUsername(authUser.username);
    }
  }, [authUser?.username]);

  // Track unsaved state
  useEffect(() => {
    if (authUser) {
      setHasUnsaved(isEditing && draftUsername.trim() !== authUser.username);
    }
  }, [isEditing, draftUsername, authUser]);

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    if (!hasUnsaved) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsaved]);

  // Real match history
  const { data: matchesData, isLoading: matchesLoading } = useMatches(
    authUser ? { userId: authUser.id, limit: 20 } : undefined,
  );
  const matches = matchesData ?? [];

  // Build a minimal ELO history from the user's current ELO
  // (a real /users/me/elo-history endpoint would be ideal — use what we have for now)
  const eloHistory: EloPoint[] = authUser
    ? [{ date: authUser.createdAt.slice(0, 10), elo: authUser.elo }]
    : [];

  const handleEnterEdit = () => {
    setDraftUsername(authUser?.username ?? "");
    setIsEditing(true);
  };

  const handleCancel = useCallback(() => {
    setDraftUsername(authUser?.username ?? "");
    setIsEditing(false);
    setHasUnsaved(false);
  }, [authUser?.username]);

  const handleSave = useCallback(async () => {
    const trimmed = draftUsername.trim();
    if (!trimmed || trimmed === authUser?.username) {
      setIsEditing(false);
      return;
    }
    try {
      setIsSaving(true);
      await api.updateProfile({ username: trimmed });
      await queryClient.invalidateQueries({ queryKey: AUTH_PROFILE_QUERY_KEY });
      setIsEditing(false);
      setHasUnsaved(false);
      notify({ type: "success", title: "Profile updated", message: "Your username has been saved." });
    } catch (err) {
      notify({
        type: "error",
        title: "Failed to save profile",
        message: err instanceof Error ? err.message : "An unexpected error occurred.",
      });
    } finally {
      setIsSaving(false);
    }
  }, [draftUsername, authUser?.username, queryClient, notify]);

  // handleUpdateUser is called by ProfileBio for bio / social links
  const handleUpdateUser = useCallback(
    async (updatedFields: Partial<User>) => {
      try {
        await api.updateProfile({
          bio: updatedFields.bio,
          avatar: updatedFields.avatar,
          socialLinks: updatedFields.socialLinks,
        });
        await queryClient.invalidateQueries({ queryKey: AUTH_PROFILE_QUERY_KEY });
        notify({ type: "success", title: "Profile updated" });
      } catch (err) {
        notify({
          type: "error",
          title: "Failed to save profile",
          message: err instanceof Error ? err.message : "An unexpected error occurred.",
        });
      }
    },
    [queryClient, notify],
  );

  useEffect(() => {
    if (!isDirty) return;

    const confirmLeave = () =>
      window.confirm(
        "You have unsaved changes. Are you sure you want to leave?"
      );

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };

    const handleLinkClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement)?.closest("a");
      if (!anchor || anchor.target === "_blank") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (!confirmLeave()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    const handlePopState = () => {
      if (!confirmLeave()) {
        window.history.pushState(null, "", window.location.href);
      }
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isDirty]);

  const handleBioDirtyChange = useCallback((dirty: boolean) => {
    setIsBioDirty(dirty);
  }, []);

  if (authLoading && !authUser) {
    return (
      <ProtectedPage>
        <ProfileSkeleton />
      </ProtectedPage>
    );
  }

  // After auth loads, authUser should be present (ProtectedPage redirects otherwise)
  const user = authUser!;

  return (
    <ProtectedPage>
      <div className="py-4 max-w-[100vw] overflow-hidden mx-auto space-y-8 animate-in fade-in duration-500">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row gap-8 items-start md:items-center bg-card border rounded-xl p-8 shadow-sm">
          <div className="relative group">
            <div className="h-32 w-32 rounded-full border-4 border-primary/10 overflow-hidden bg-muted flex items-center justify-center transform group-hover:scale-105 transition-transform duration-300">
              {user.avatar ? (
                <Image src={user.avatar} alt={user.username} fill className="object-cover" unoptimized />
              ) : (
                <span className="text-4xl font-bold text-muted-foreground">
                  {user.username.charAt(0)}
                </span>
              )}
            </div>
            <div className="absolute -bottom-1 -right-1 h-8 w-8 bg-success border-4 border-card rounded-full" title="Online" />
          </div>

          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              {isEditing ? (
                <input
                  type="text"
                  value={draftUsername}
                  onChange={(e) => setDraftUsername(e.target.value)}
                  aria-label="Username"
                  data-testid="profile-username-input"
                  className="text-4xl font-extrabold tracking-tight text-foreground bg-transparent border-b-2 border-primary/40 focus:border-primary focus:outline-none px-1"
                />
              ) : (
                <h1 className="text-4xl font-extrabold tracking-tight text-foreground">{user.username}</h1>
              )}
              <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider rounded-full border border-primary/20">
                Pro Player
              </span>
            </div>
            <p className="text-muted-foreground flex items-center gap-2">
              {user.email}
              <span className="h-1 w-1 bg-muted-foreground rounded-full" />
              Joined {new Date(user.createdAt).toLocaleDateString()}
            </p>
            <div className="flex gap-4 mt-4">
              <div className="bg-muted/50 px-4 py-2 rounded-lg border">
                <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Current Elo</p>
                <p className="text-xl font-black text-primary">{user.elo}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {isEditing ? (
                <>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving || draftUsername.trim().length === 0}
                    data-testid="profile-save"
                  >
                    {isSaving ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCancel}
                    disabled={isSaving}
                    data-testid="profile-cancel"
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleEnterEdit}
                  data-testid="profile-edit"
                >
                  Edit Profile
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column - Stats & Bio */}
          <div className="lg:col-span-2 space-y-8">
            {eloHistory.length > 0 && <EloChart data={eloHistory} />}
            <ProfileBio user={user} onSave={handleUpdateUser} />
          </div>

          {/* Right Column - Match History */}
          <div className="space-y-8">
            {matchesLoading ? (
              <div className="h-64 bg-muted animate-pulse rounded-xl" />
            ) : (
              <MatchHistory matches={matches} currentUserId={user.id} />
            )}
          </div>
        </div>
      </div>
    </ProtectedPage>
  );
}
