"use client";

import { useState } from "react";
import Image from "next/image";
import { useAuth } from "@/hooks/useAuth";
import { EloChart } from "@/components/profile/EloChart";
import { MatchHistory } from "@/components/profile/MatchHistory";
import { ProfileBio } from "@/components/profile/ProfileBio";
import { StatsOverview } from "@/components/dashboard/StatsOverview";
import { currentUser as fallbackUser, mockEloHistory } from "@/data/user";
import { mockMatchHistory } from "@/data/matches";
import { User } from "@/types/user";

export default function DashboardProfilePage() {
  const { user: authUser } = useAuth();
  const [user, setUser] = useState<User>(authUser ?? fallbackUser);

  const wins = mockMatchHistory.filter((m) => m.winnerId === user.id).length;
  const losses = mockMatchHistory.length - wins;
  const winRate = mockMatchHistory.length > 0 ? Math.round((wins / mockMatchHistory.length) * 100) : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col md:flex-row gap-6 items-start md:items-center bg-card border rounded-xl p-8 shadow-sm">
        <div className="relative group shrink-0">
          <div className="h-24 w-24 rounded-full border-4 border-primary/10 overflow-hidden bg-muted flex items-center justify-center">
            {user.avatar ? (
              <Image src={user.avatar} alt={user.username} fill className="object-cover" unoptimized />
            ) : (
              <span className="text-3xl font-bold text-muted-foreground">{user.username.charAt(0)}</span>
            )}
          </div>
          <div className="absolute -bottom-1 -right-1 h-6 w-6 bg-green-500 border-4 border-card rounded-full" />
        </div>
        <div className="flex-1 space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight">{user.username}</h1>
          <p className="text-sm text-muted-foreground">
            {user.email} · Joined {new Date(user.createdAt).toLocaleDateString()}
          </p>
          <div className="flex gap-3 mt-3">
            <div className="bg-muted/50 px-4 py-2 rounded-lg border">
              <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Rank</p>
              <p className="text-lg font-black italic">#420</p>
            </div>
            <div className="bg-primary/5 px-4 py-2 rounded-lg border border-primary/20">
              <p className="text-[10px] uppercase font-bold text-primary tracking-widest">ELO</p>
              <p className="text-lg font-black text-primary">{user.elo}</p>
            </div>
          </div>
        </div>
      </div>

      <StatsOverview elo={user.elo} wins={wins} losses={losses} winRate={winRate} rank={420} streak={3} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <EloChart data={mockEloHistory} />
          <MatchHistory matches={mockMatchHistory} currentUserId={user.id} />
        </div>
        <div>
          <ProfileBio user={user} onSave={(fields) => setUser((prev) => ({ ...prev, ...fields }))} />
        </div>
      </div>
    </div>
  );
}
