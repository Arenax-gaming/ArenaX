"use client";

import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useState, useMemo, useCallback, useEffect } from "react";
import { TournamentCardWithQuickJoin } from "@/components/tournaments/TournamentCardWithQuickJoin";
import { TournamentCardSkeleton } from "@/components/tournaments/TournamentCardSkeleton";
import { TournamentFilter } from "@/components/tournaments/TournamentFilter";
import { TournamentStatus, Tournament, TournamentFilters } from "@/types/tournament";
import { Button } from "@/components/ui/Button";
import { mockTournaments } from "@/data/mockTournaments";
import { useAuth } from "@/hooks/useAuth";
import { Trophy, Users } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { TournamentStatus, Tournament } from "@/types/tournament";
import { Button } from "@/components/ui/Button";
import { mockTournaments } from "@/data/mockTournaments";
import { useAuth } from "@/hooks/useAuth";
import { Search, Filter, SortAsc, Trophy, Users, Plus } from "lucide-react";

type TabType = "joined" | "available";

export default function TournamentsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabType>("available");
  const [filters, setFilters] = useState<TournamentFilters>({
    search: searchParams.get("search") || undefined,
    status: (searchParams.get("status") as TournamentStatus) || undefined,
    gameType: searchParams.get("gameType") || undefined,
    tournamentType: (searchParams.get("tournamentType") as any) || undefined,
    minEntryFee: searchParams.get("minEntryFee") ? Number(searchParams.get("minEntryFee")) : undefined,
    maxEntryFee: searchParams.get("maxEntryFee") ? Number(searchParams.get("maxEntryFee")) : undefined,
    minPrizePool: searchParams.get("minPrizePool") ? Number(searchParams.get("minPrizePool")) : undefined,
    maxPrizePool: searchParams.get("maxPrizePool") ? Number(searchParams.get("maxPrizePool")) : undefined,
    sortBy: (searchParams.get("sortBy") as TournamentFilters['sortBy']) || "date",
    sortOrder: (searchParams.get("sortOrder") as 'asc' | 'desc') || "desc",
  });

  // Track joined tournaments (simulated - in real app this would come from API)
  const [joinedTournamentIds, setJoinedTournamentIds] = useState<Set<string>>(
    new Set(["2"]) // Mock: user has joined tournament ID 2
  );

  // Simulate data fetching
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

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
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      tournaments = tournaments.filter(
        (tournament) =>
          tournament.name.toLowerCase().includes(searchLower) ||
          tournament.gameType.toLowerCase().includes(searchLower) ||
          (tournament.description?.toLowerCase().includes(searchLower) ?? false)
      );
    }

    // Apply status filter
    if (filters.status) {
      tournaments = tournaments.filter(
        (tournament) => tournament.status === filters.status
      );
    }

    // Apply game type filter
    if (filters.gameType) {
      tournaments = tournaments.filter(
        (tournament) => tournament.gameType === filters.gameType
      );
    }

    // Apply tournament type filter
    if (filters.tournamentType) {
      tournaments = tournaments.filter(
        (tournament) => tournament.tournamentType === filters.tournamentType
      );
    }

    // Apply entry fee range filter
    if (filters.minEntryFee !== undefined) {
      tournaments = tournaments.filter(
        (tournament) => tournament.entryFee >= filters.minEntryFee!
      );
    }
    if (filters.maxEntryFee !== undefined) {
      tournaments = tournaments.filter(
        (tournament) => tournament.entryFee <= filters.maxEntryFee!
      );
    }

    // Apply prize pool range filter
    if (filters.minPrizePool !== undefined) {
      tournaments = tournaments.filter(
        (tournament) => tournament.prizePool >= filters.minPrizePool!
      );
    }
    if (filters.maxPrizePool !== undefined) {
      tournaments = tournaments.filter(
        (tournament) => tournament.prizePool <= filters.maxPrizePool!
      );
    }

    // Apply sorting
    tournaments = [...tournaments].sort((a, b) => {
      let comparison = 0;

      switch (filters.sortBy) {
        case "date":
          comparison = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
          break;
        case "prize_pool":
          comparison = a.prizePool - b.prizePool;
          break;
        case "participants":
          comparison = a.currentParticipants - b.currentParticipants;
          break;
        default:
          comparison = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      }

      return filters.sortOrder === "asc" ? comparison : -comparison;
    });

    return tournaments;
  }, [filters, activeTab, joinedTournamentIds]);

  const handleJoinSuccess = useCallback((tournamentId: string) => {
    setJoinedTournamentIds((prev) => {
      const newSet = new Set<string>(prev);
      newSet.add(tournamentId);
      return newSet;
    });
  }, []);

  // Handle filter changes from TournamentFilter component
  const handleFiltersChange = useCallback((newFilters: TournamentFilters) => {
    setFilters(newFilters);
  }, []);

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
            className={`inline-flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === "available"
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
            className={`inline-flex items-center gap-2 px-6 py-2 rounded-md text-sm font-medium transition-all ${activeTab === "joined"
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
        <TournamentFilter
          availableGameTypes={availableGameTypes}
          onFiltersChange={handleFiltersChange}
        />
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
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <TournamentCardSkeleton key={index} />
          ))}
        </div>
      ) : filteredTournaments.length > 0 ? (
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
        <EmptyState
          icon={Trophy}
          title="No tournaments found"
          description={
            activeTab === "joined"
              ? "You haven't joined any tournaments yet. Browse available tournaments to join!"
              : filters.search || filters.status || filters.gameType || filters.tournamentType || filters.minEntryFee || filters.maxEntryFee || filters.minPrizePool || filters.maxPrizePool
                ? "Try adjusting your search or filters"
                : "No tournaments are currently available"}
          </p>
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
