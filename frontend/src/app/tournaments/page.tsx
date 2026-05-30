"use client";

import { useState, useMemo, useCallback, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Filter, SortAsc, Trophy, Users, Plus } from "lucide-react";
import { TournamentCardWithQuickJoin } from "@/components/tournaments/TournamentCardWithQuickJoin";
import { TournamentCardSkeleton } from "@/components/tournaments/TournamentCardSkeleton";
import { TournamentFilter } from "@/components/tournaments/TournamentFilter";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/Button";
import {
  TournamentStatus,
  Tournament,
  TournamentFilters,
  TournamentPageStatus,
  TOURNAMENT_PAGE_STATUS_COLORS,
  TOURNAMENT_PAGE_STATUSES,
  toTournamentPageStatus,
} from "@/types/tournament";
import { mockTournaments } from "@/data/mockTournaments";
import { useAuth } from "@/hooks/useAuth";

type TabType = "joined" | "available";

const statusColors = TOURNAMENT_PAGE_STATUS_COLORS;

function getStatusStyles(pageStatus: TournamentPageStatus) {
  return statusColors[pageStatus];
}

function TournamentsContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabType>("available");
  const [isLoading, setIsLoading] = useState(true);
  const [filters, setFilters] = useState<TournamentFilters>({
    search: searchParams.get("search") || undefined,
    status: (searchParams.get("status") as TournamentStatus) || undefined,
    gameType: searchParams.get("gameType") || undefined,
    tournamentType: (searchParams.get("tournamentType") as any) || undefined,
    minEntryFee: searchParams.get("minEntryFee")
      ? Number(searchParams.get("minEntryFee"))
      : undefined,
    maxEntryFee: searchParams.get("maxEntryFee")
      ? Number(searchParams.get("maxEntryFee"))
      : undefined,
    minPrizePool: searchParams.get("minPrizePool")
      ? Number(searchParams.get("minPrizePool"))
      : undefined,
    maxPrizePool: searchParams.get("maxPrizePool")
      ? Number(searchParams.get("maxPrizePool"))
      : undefined,
    sortBy:
      (searchParams.get("sortBy") as TournamentFilters["sortBy"]) || "date",
    sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
  });

  const [joinedTournamentIds, setJoinedTournamentIds] = useState<Set<string>>(
    new Set(["2"]),
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  const availableGameTypes = useMemo(() => {
    const types = new Set(mockTournaments.map((t) => t.gameType));
    return Array.from(types).sort();
  }, []);

  const filteredTournaments = useMemo(() => {
    let tournaments = mockTournaments.filter((tournament) => {
      const isJoined = joinedTournamentIds.has(tournament.id);

      if (activeTab === "joined") {
        return isJoined;
      } else {
        return !isJoined;
      }
    });

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      tournaments = tournaments.filter(
        (tournament) =>
          tournament.name.toLowerCase().includes(searchLower) ||
          tournament.gameType.toLowerCase().includes(searchLower) ||
          (tournament.description?.toLowerCase().includes(searchLower) ??
            false),
      );
    }

    if (filters.status) {
      tournaments = tournaments.filter(
        (tournament) => tournament.status === filters.status,
      );
    }

    if (filters.pageStatus) {
      tournaments = tournaments.filter(
        (tournament) =>
          toTournamentPageStatus(tournament.status) === filters.pageStatus,
      );
    }

    if (filters.gameType) {
      tournaments = tournaments.filter(
        (tournament) => tournament.gameType === filters.gameType,
      );
    }

    if (filters.tournamentType) {
      tournaments = tournaments.filter(
        (tournament) => tournament.tournamentType === filters.tournamentType,
      );
    }

    if (filters.minEntryFee !== undefined) {
      tournaments = tournaments.filter(
        (tournament) => tournament.entryFee >= filters.minEntryFee!,
      );
    }
    if (filters.maxEntryFee !== undefined) {
      tournaments = tournaments.filter(
        (tournament) => tournament.entryFee <= filters.maxEntryFee!,
      );
    }

    if (filters.minPrizePool !== undefined) {
      tournaments = tournaments.filter(
        (tournament) => tournament.prizePool >= filters.minPrizePool!,
      );
    }
    if (filters.maxPrizePool !== undefined) {
      tournaments = tournaments.filter(
        (tournament) => tournament.prizePool <= filters.maxPrizePool!,
      );
    }

    tournaments = [...tournaments].sort((a, b) => {
      let comparison = 0;

      switch (filters.sortBy) {
        case "date":
          comparison =
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
          break;
        case "prize_pool":
          comparison = a.prizePool - b.prizePool;
          break;
        case "participants":
          comparison = a.currentParticipants - b.currentParticipants;
          break;
        default:
          comparison =
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
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

  const handleFiltersChange = useCallback((newFilters: TournamentFilters) => {
    setFilters(newFilters);
  }, []);

  const joinedCount = joinedTournamentIds.size;
  const availableCount = mockTournaments.length - joinedCount;

  return (
    <div className="min-h-screen px-4 py-8 bg-background">
      <div className="space-y-2 mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">
          Tournament Dashboard
        </h1>
        <p className="text-lg text-muted-foreground">
          Browse, join, and manage your tournament competitions
        </p>
      </div>

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

      <div className="bg-card border rounded-lg p-6 mb-6">
        <TournamentFilter
          availableGameTypes={availableGameTypes}
          onFiltersChange={handleFiltersChange}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {filteredTournaments.length} tournament
          {filteredTournaments.length !== 1 ? "s" : ""} found
          {activeTab === "joined" ? " (joined)" : " (available)"}
        </p>
        <div className="flex flex-wrap gap-2" aria-label="Tournament status legend">
          {TOURNAMENT_PAGE_STATUSES.map((pageStatus) => {
            const { badgeClass, label } = getStatusStyles(pageStatus);
            return (
              <span
                key={pageStatus}
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass}`}
              >
                {label}
              </span>
            );
          })}
        </div>
      </div>

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
              : filters.search ||
                  filters.status ||
                  filters.gameType ||
                  filters.tournamentType ||
                  filters.minEntryFee ||
                  filters.maxEntryFee ||
                  filters.minPrizePool ||
                  filters.maxPrizePool
                ? "Try adjusting your search or filters"
                : "No tournaments are currently available"
          }
        >
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
        </EmptyState>
      )}
    </div>
  );
}

export default function TournamentsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen px-4 py-8 bg-background">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-16">
          {Array.from({ length: 6 }).map((_, i) => (
            <TournamentCardSkeleton key={i} />
          ))}
        </div>
      </div>
    }>
      <TournamentsContent />
    </Suspense>
  );
}
