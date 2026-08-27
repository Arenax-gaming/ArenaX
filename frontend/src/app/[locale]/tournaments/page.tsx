"use client";

import { useState, useMemo, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Trophy, Users } from "lucide-react";
import { TournamentCardWithQuickJoin } from "@/components/tournaments/TournamentCardWithQuickJoin";
import { TournamentCardSkeleton } from "@/components/tournaments/TournamentCardSkeleton";
import { TournamentFilter } from "@/components/tournaments/TournamentFilter";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/Button";
import {
  TournamentStatus,
  TournamentFilters,
  TournamentPageStatus,
  TOURNAMENT_PAGE_STATUS_COLORS,
  TOURNAMENT_PAGE_STATUSES,
} from "@/types/tournament";
import { useTournaments, useJoinedTournaments } from "@/hooks/useTournaments";
import { useAuth } from "@/hooks/useAuth";
import { TOURNAMENT_GRID_IMAGE_SIZES } from "@/lib/tournamentImageSizes";

type TabType = "joined" | "available";

function getStatusStyles(pageStatus: TournamentPageStatus) {
  return TOURNAMENT_PAGE_STATUS_COLORS[pageStatus];
}

function TournamentsContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab] = useState<TabType>("available");

  // Filters — each change triggers a new API call
  const [filters, setFilters] = useState<TournamentFilters>({
    search:          searchParams.get("search")          || undefined,
    status:          (searchParams.get("status") as TournamentStatus) || undefined,
    gameType:        searchParams.get("gameType")        || undefined,
    tournamentType:  (searchParams.get("tournamentType") as any) || undefined,
    minEntryFee:     searchParams.get("minEntryFee")     ? Number(searchParams.get("minEntryFee"))  : undefined,
    maxEntryFee:     searchParams.get("maxEntryFee")     ? Number(searchParams.get("maxEntryFee"))  : undefined,
    minPrizePool:    searchParams.get("minPrizePool")    ? Number(searchParams.get("minPrizePool")) : undefined,
    maxPrizePool:    searchParams.get("maxPrizePool")    ? Number(searchParams.get("maxPrizePool")) : undefined,
    sortBy:          (searchParams.get("sortBy") as TournamentFilters["sortBy"]) || "date",
    sortOrder:       (searchParams.get("sortOrder") as "asc" | "desc") || "desc",
  });

  // --- Real API calls ---
  const {
    data: tournaments = [],
    isLoading,
    isError,
    refetch,
  } = useTournaments(filters);

  const { data: joinedIds = [] } = useJoinedTournaments(user?.id);

  // Local optimistic joined state — starts from server value, updated on join
  const [localJoined, setLocalJoined] = useState<string[]>([]);

  const allJoinedIds = useMemo(
    () => new Set([...joinedIds, ...localJoined]),
    [joinedIds, localJoined],
  );

  // Partition into tabs (the API already returns all tournaments matching the
  // filter params; we split joined/available on the client so we don't need
  // two separate API calls for each tab).
  const visibleTournaments = useMemo(() => {
    return tournaments.filter((t) => {
      const isJoined = allJoinedIds.has(t.id);
      return activeTab === "joined" ? isJoined : !isJoined;
    });
  }, [tournaments, allJoinedIds, activeTab]);

  // Derive available game types from the current result set for the filter UI
  const availableGameTypes = useMemo(() => {
    const types = new Set(tournaments.map((t) => t.gameType));
    return Array.from(types).sort();
  }, [tournaments]);

  const handleJoinSuccess = useCallback((tournamentId: string) => {
    setLocalJoined((prev) => [...prev, tournamentId]);
  }, []);

  const handleFiltersChange = useCallback((newFilters: TournamentFilters) => {
    setFilters(newFilters);
  }, []);

  const joinedCount = allJoinedIds.size;
  const availableCount = tournaments.length - joinedCount;
  const hasActiveFilters = !!(
    filters.search ||
    filters.status ||
    filters.gameType ||
    filters.tournamentType ||
    filters.minEntryFee !== undefined ||
    filters.maxEntryFee !== undefined ||
    filters.minPrizePool !== undefined ||
    filters.maxPrizePool !== undefined
  );

  const tabs = useMemo(
    () =>
      [
        { id: "available" as TabType, label: "Available", icon: Trophy, count: availableCount },
        { id: "joined" as TabType, label: "Joined", icon: Users, count: joinedCount },
      ],
    [availableCount, joinedCount],
  );

  const tabRefs = useRef<Record<TabType, HTMLButtonElement | null>>({
    available: null,
    joined: null,
  });

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = (index + 1) % tabs.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = (index - 1 + tabs.length) % tabs.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = tabs.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const nextTab = tabs[nextIndex].id;
      setActiveTab(nextTab);
      tabRefs.current[nextTab]?.focus();
    },
    [tabs],
  );

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

      {/* Tab switcher */}
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
              {isLoading ? "…" : availableCount}
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
              {isLoading ? "…" : joinedCount}
            </span>
          </button>
        </div>
      </div>

      {/* Filter panel */}
      <div className="bg-card border rounded-lg p-6 mb-6">
        <TournamentFilter
          availableGameTypes={availableGameTypes}
          onFiltersChange={handleFiltersChange}
        />
      </div>

      {/* Result count + status legend */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? "Loading tournaments…"
            : `${visibleTournaments.length} tournament${visibleTournaments.length !== 1 ? "s" : ""} found${activeTab === "joined" ? " (joined)" : " (available)"}`}
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

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <TournamentCardSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <Trophy className="h-12 w-12 text-muted-foreground opacity-40" />
          <p className="text-lg font-semibold">Failed to load tournaments</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Something went wrong fetching tournament data. Please try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : visibleTournaments.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleTournaments.map((tournament) => (
            <TournamentCardWithQuickJoin
              key={tournament.id}
              tournament={tournament}
              isJoined={allJoinedIds.has(tournament.id)}
              onJoinSuccess={handleJoinSuccess}
              bannerSizes={TOURNAMENT_GRID_IMAGE_SIZES}
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
              : hasActiveFilters
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
    <Suspense
      fallback={
        <div className="min-h-screen px-4 py-8 bg-background">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-16">
            {Array.from({ length: 6 }).map((_, i) => (
              <TournamentCardSkeleton key={i} />
            ))}
          </div>
        </div>
      }
    >
      <TournamentsContent />
    </Suspense>
  );
}
