"use client";

import { useState, useMemo, useCallback } from "react";
import { TournamentCardWithQuickJoin } from "@/components/tournaments/TournamentCardWithQuickJoin";
import { TournamentFilter } from "@/components/tournaments/TournamentFilter";
import { TournamentStatus, Tournament } from "@/types/tournament";
import { Button } from "@/components/ui/Button";
import { mockTournaments } from "@/data/mockTournaments";
import { useAuth } from "@/hooks/useAuth";
import { Search, Filter, SortAsc, Trophy, Users } from "lucide-react";

type TabType = "joined" | "available";
type SortOption = "name" | "startTime" | "entryFee" | "prizePool" | "participants";
type EntryFeeFilter = "all" | "free" | "paid";

export default function TournamentsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>("available");
  const [searchValue, setSearchValue] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<TournamentStatus | null>(null);
  const [selectedGameType, setSelectedGameType] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>("startTime");
  const [sortAsc, setSortAsc] = useState(true);
  const [entryFeeFilter, setEntryFeeFilter] = useState<EntryFeeFilter>("all");
  
  // Track joined tournaments (simulated - in real app this would come from API)
  const [joinedTournamentIds, setJoinedTournamentIds] = useState<Set<string>>(
    new Set(["2"]) // Mock: user has joined tournament ID 2
  );

  // Get available game types from tournaments
  const availableGameTypes = useMemo(() => {
    const types = new Set(mockTournaments.map((t) => t.gameType));
    return Array.from(types).sort();
  }, []);

  // Filter tournaments based on all criteria
  const filteredTournaments = useMemo(() => {
    // First, filter based on joined/available tabs
    let tournaments = mockTournaments.filter((tournament) => {
      const isJoined = joinedTournamentIds.has(tournament.id);
      
      if (activeTab === "joined") {
        return isJoined;
      } else {
        return !isJoined;
      }
    });

    // Apply search filter
    if (searchValue) {
      const searchLower = searchValue.toLowerCase();
      tournaments = tournaments.filter(
        (tournament) =>
          tournament.name.toLowerCase().includes(searchLower) ||
          tournament.gameType.toLowerCase().includes(searchLower) ||
          (tournament.description?.toLowerCase().includes(searchLower) ?? false)
      );
    }

    // Apply status filter
    if (selectedStatus) {
      tournaments = tournaments.filter(
        (tournament) => tournament.status === selectedStatus
      );
    }

    // Apply game type filter
    if (selectedGameType) {
      tournaments = tournaments.filter(
        (tournament) => tournament.gameType === selectedGameType
      );
    }

    // Apply entry fee filter
    if (entryFeeFilter !== "all") {
      tournaments = tournaments.filter((tournament) => {
        if (entryFeeFilter === "free") {
          return tournament.entryFee === 0;
        } else {
          return tournament.entryFee > 0;
        }
      });
    }

    // Apply sorting
    tournaments = [...tournaments].sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "startTime":
          comparison = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
          break;
        case "entryFee":
          comparison = a.entryFee - b.entryFee;
          break;
        case "prizePool":
          comparison = a.prizePool - b.prizePool;
          break;
        case "participants":
          comparison = a.currentParticipants - b.currentParticipants;
          break;
      }
      
      return sortAsc ? comparison : -comparison;
    });

    return tournaments;
  }, [searchValue, selectedStatus, selectedGameType, sortBy, sortAsc, entryFeeFilter, activeTab, joinedTournamentIds]);

  const handleReset = useCallback(() => {
    setSearchValue("");
    setSelectedStatus(null);
    setSelectedGameType(null);
    setEntryFeeFilter("all");
    setSortBy("startTime");
    setSortAsc(true);
  }, []);

  const handleJoinSuccess = useCallback((tournamentId: string) => {
    setJoinedTournamentIds((prev) => {
      const newSet = new Set<string>(prev);
      newSet.add(tournamentId);
      return newSet;
    });
  }, []);

  const toggleSort = (option: SortOption) => {
    if (sortBy === option) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(option);
      setSortAsc(true);
    }
  };

  // Stats for the dashboard header
  const joinedCount = joinedTournamentIds.size;
  const availableCount = mockTournaments.length - joinedCount;

  return (
    <div className="min-h-screen px-4 py-8 bg-background">
      {/* Header */}
      <div className="space-y-2 mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">
          Tournament Dashboard
        </h1>
        <p className="text-lg text-muted-foreground">
          Browse, join, and manage your tournament competitions
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex rounded-lg border bg-muted p-1">
          <button
            onClick={() => setActiveTab("available")}
            className={`inline-flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === "available"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Trophy className="h-4 w-4" />
            Available
            <span className="ml-1 text-xs bg-muted-foreground/20 px-2 py-0.5 rounded-full">
              {availableCount}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("joined")}
            className={`inline-flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === "joined"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="h-4 w-4" />
            Joined
            <span className="ml-1 text-xs bg-muted-foreground/20 px-2 py-0.5 rounded-full">
              {joinedCount}
            </span>
          </button>
        </div>
      </div>

      {/* Filters Section */}
      <div className="bg-card border rounded-lg p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Filters & Sort</h2>
        </div>
        
        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search tournaments by name, game, or description..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 pl-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>
        </div>

        {/* Filter Row */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Status Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Status</label>
            <select
              value={selectedStatus || ""}
              onChange={(e) => setSelectedStatus(e.target.value as TournamentStatus || null)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All Statuses</option>
              <option value="registration_open">Registration Open</option>
              <option value="in_progress">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="registration_closed">Registration Closed</option>
            </select>
          </div>

          {/* Game Type Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Game Type</label>
            <select
              value={selectedGameType || ""}
              onChange={(e) => setSelectedGameType(e.target.value || null)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All Games</option>
              {availableGameTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {/* Entry Fee Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Entry Fee</label>
            <select
              value={entryFeeFilter}
              onChange={(e) => setEntryFeeFilter(e.target.value as EntryFeeFilter)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="all">All Fees</option>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
            </select>
          </div>

          {/* Sort */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Sort By</label>
            <div className="flex gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="startTime">Start Time</option>
                <option value="name">Name</option>
                <option value="entryFee">Entry Fee</option>
                <option value="prizePool">Prize Pool</option>
                <option value="participants">Participants</option>
              </select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSortAsc(!sortAsc)}
                className="px-3"
              >
                <SortAsc className={`h-4 w-4 transition-transform ${!sortAsc ? "rotate-180" : ""}`} />
              </Button>
            </div>
          </div>
        </div>

        {/* Reset Button */}
        {(searchValue || selectedStatus || selectedGameType || entryFeeFilter !== "all") && (
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Reset Filters
            </Button>
          </div>
        )}
      </div>

      {/* Results Count */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {filteredTournaments.length} tournament
          {filteredTournaments.length !== 1 ? "s" : ""} found
          {activeTab === "joined" ? " (joined)" : " (available)"}
        </p>
      </div>

      {/* Tournament Grid or Empty State */}
      {filteredTournaments.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTournaments.map((tournament) => (
            <TournamentCardWithQuickJoin
              key={tournament.id}
              tournament={tournament}
              isJoined={joinedTournamentIds.has(tournament.id)}
              onJoinSuccess={handleJoinSuccess}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12">
          <Trophy className="h-16 w-16 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No tournaments found
          </h3>
          <p className="text-muted-foreground mb-4">
            {activeTab === "joined"
              ? "You haven't joined any tournaments yet. Browse available tournaments to join!"
              : searchValue || selectedStatus || selectedGameType || entryFeeFilter !== "all"
                ? "Try adjusting your search or filters"
                : "No tournaments are currently available"}
          </p>
          {(searchValue || selectedStatus || selectedGameType || entryFeeFilter !== "all") && (
            <Button
              onClick={handleReset}
              variant="ghost"
              size="sm"
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium text-sm"
            >
              Reset filters
            </Button>
          )}
          {activeTab === "joined" && (
            <Button
              onClick={() => setActiveTab("available")}
              variant="outline"
              size="sm"
              className="mt-4"
            >
              Browse Available Tournaments
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
