"use client";

import React, { useState } from "react";
import { EloChart } from "@/components/profile/EloChart";
import { MatchHistory } from "@/components/profile/MatchHistory";
import { ProfileBio } from "@/components/profile/ProfileBio";
import { currentUser as initialUser, mockEloHistory } from "@/data/user";
import { mockMatchHistory } from "@/data/matches";
import { User } from "@/types/user";

export default function ProfilePage() {
  const [user, setUser] = useState<User>(initialUser);

  const handleUpdateUser = (updatedFields: Partial<User>) => {
    setUser((prev) => ({ ...prev, ...updatedFields }));
  };

  return (
    <div className="py-4 max-w-[100vw] overflow-hidden mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row gap-8 items-start md:items-center bg-card border rounded-xl p-8 shadow-sm">
        <div className="relative group">
          <div className="h-32 w-32 rounded-full border-4 border-primary/10 overflow-hidden bg-muted flex items-center justify-center transform group-hover:scale-105 transition-transform duration-300">
            {user.avatar ? (
              <img src={user.avatar} alt={user.username} className="h-full w-full object-cover" />
            ) : (
              <span className="text-4xl font-bold text-muted-foreground">
                {user.username.charAt(0)}
              </span>
            )}
          </div>
          <div className="absolute -bottom-1 -right-1 h-8 w-8 bg-green-500 border-4 border-card rounded-full" title="Online" />
        </div>

        <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-4xl font-extrabold tracking-tight text-foreground">{user.username}</h1>
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
                    <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Global Rank</p>
                    <p className="text-xl font-black italic">#420</p>
                </div>
                <div className="bg-primary/5 px-4 py-2 rounded-lg border border-primary/20">
                    <p className="text-[10px] uppercase font-bold text-primary tracking-widest">Current Elo</p>
                    <p className="text-xl font-black text-primary">{user.elo}</p>
                </div>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column - Stats & Bio */}
        <div className="lg:col-span-2 space-y-8">
          <EloChart data={mockEloHistory} />
          <ProfileBio user={user} onSave={handleUpdateUser} />
        </div>

        {/* Right Column - Match History */}
        <div className="space-y-8">
           <MatchHistory matches={mockMatchHistory} currentUserId={user.id} />
        </div>
      </div>
    </div>
  );
}
