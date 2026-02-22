"use client";

import { useState, useMemo } from "react";
import { TournamentCard } from "@/components/tournaments/TournamentCard";
import { TournamentFilter, EntryFeeFilter, SortOption } from "@/components/tournaments/TournamentFilter";
import { TournamentStatus } from "@/types/tournament";
import { mockTournaments } from "@/data/mockTournaments";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { QuickJoinModal } from "@/components/game/QuickJoinModal";
import { Tournament } from "@/types/tournament";
import { Users } from "lucide-react";

export default function TournamentsPage() {
  // Search and filter state
  const [searchValue, setSearchValue] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<TournamentStatus | null>(null);
  const [selectedGameType, setSelectedGameType] = useState<string | null>(null);
  const [entryFeeFilter, setEntryFeeFilter] = useState<EntryFeeFilter>({ type: "all" });
  const [sortOption, setSortOption] = useState<SortOption>({ type: "newest" });
  
  // Tab state
  const [activeTab, setActiveTab] = useState<"available" | "joined">("available");
  
  // Quick join modal state
  const [quickJoinTournament, setQuickJoinTournament] = useState<Tournament | null>(null);
  
  // Mock user's joined tournament IDs (in real app, this would come from API)
  const [joinedTournamentIds, setJoinedTournamentIds] = useState<Set<string>>(
    new Set(["2", "7"]) // Pre-populate some joined tournaments for demo
  );

  const availableGameTypes = useMemo(() => {
    const types = new Set(mockTournaments.map((t) => t.gameType));
    return Array.from(types).sort();
  }, []);

  // Filter and sort logic for tournaments - Extended with entry fee filter
  const filterAndSortTournaments = useMemo(() => {
    return (tournaments: Tournament[]): Tournament[] => {
      // First filter
      let filtered = tournaments.filter((tournament) => {
        const searchLower = searchValue.toLowerCase();
        const matchesSearch =
          tournament.name.toLowerCase().includes(searchLower) ||
          tournament.gameType.toLowerCase().includes(searchLower) ||
          (tournament.description?.toLowerCase().includes(searchLower) ?? false);

        const matchesStatus = !selectedStatus || tournament.status === selectedStatus;
        const matchesGameType = !selectedGameType || tournament.gameType === selectedGameType;
        
        // Entry fee filter logic
        let matchesEntryFee = true;
        if (entryFeeFilter.type === "free") {
          matchesEntryFee = tournament.entryFee === 0;
        } else if (entryFeeFilter.type === "paid") {
          matchesEntryFee = tournament.entryFee > 0;
        } else if (entryFeeFilter.type === "custom") {
          matchesEntryFee = 
            tournament.entryFee >= entryFeeFilter.min && 
            tournament.entryFee <= entryFeeFilter.max;
        }

        return matchesSearch && matchesStatus && matchesGameType && matchesEntryFee;
      });

      // Then sort
      filtered = [...filtered].sort((a, b) => {
        switch (sortOption.type) {
          case "newest":
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          case "oldest":
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          case "highest_prize":
            return b.prizePool - a.prizePool;
          case "lowest_fee":
            return a.entryFee - b.entryFee;
          case "soonest":
            return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
          default:
            return 0;
        }
      });

      return filtered;
    };
  }, [searchValue, selectedStatus, selectedGameType, entryFeeFilter, sortOption]);

  // Get available tournaments (not joined)
  const availableTournaments = useMemo(() => {
    const notJoined = mockTournaments.filter(
      (t) => !joinedTournamentIds.has(t.id)
    );
    return filterAndSortTournaments(notJoined);
  }, [filterAndSortTournaments, joinedTournamentIds]);

  // Get joined tournaments
  const joinedTournaments = useMemo(() => {
    const joined = mockTournaments.filter(
      (t) => joinedTournamentIds.has(t.id)
    );
    return filterAndSortTournaments(joined);
  }, [filterAndSortTournaments, joinedTournamentIds]);

  // Current tournaments based on tab
  const currentTournaments = activeTab === "available" 
    ? availableTournaments 
    : joinedTournaments;

  const handleReset = () => {
    setSearchValue("");
    setSelectedStatus(null);
    setSelectedGameType(null);
    setEntryFeeFilter({ type: "all" });
    setSortOption({ type: "newest" });
  };

  // Quick join handlers
  const handleQuickJoin = (tournament: Tournament) => {
    setQuickJoinTournament(tournament);
  };

  const handleConfirmJoin = async (): Promise<boolean> => {
    if (!quickJoinTournament) return false;
    
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    // Add to joined tournaments
    setJoinedTournamentIds((prev) => {
      const newSet = new Set<string>();
      prev.forEach((id) => newSet.add(id));
      newSet.add(quickJoinTournament.id);
      return newSet;
    });
    
    return true;
  };

  return (
    <div className="min-h-screen px-4 py-8 bg-background">
      {/* Header */}
      <div className="space-y-2 mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-foreground">
          Tournaments
        </h1>
        <p className="text-lg text-muted-foreground">
          Browse and join exciting esports competitions
        </p>
      </div>

      {/* Filters */}
      <TournamentFilter
        onSearchChange={setSearchValue}
        onStatusChange={setSelectedStatus}
        onGameTypeChange={setSelectedGameType}
        searchValue={searchValue}
        selectedStatus={selectedStatus}
        selectedGameType={selectedGameType}
        availableGameTypes={availableGameTypes}
        onReset={handleReset}
        entryFeeFilter={entryFeeFilter}
        onEntryFeeChange={setEntryFeeFilter}
        sortOption={sortOption}
        onSortChange={setSortOption}
      />

      {/* Tabs */}
      <div className="mt-6">
        <Tabs defaultValue="available" onValueChange={(v) => setActiveTab(v as "available" | "joined")}>
          <TabsList variant="pills" className="mb-4">
            <TabsTrigger value="available" className="gap-2">
              <Users className="h-4 w-4" />
              Available Tournaments
              <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">
                {mockTournaments.length - joinedTournamentIds.size}
              </span>
            </TabsTrigger>
            <TabsTrigger value="joined" className="gap-2">
              <Users className="h-4 w-4" />
              Joined Tournaments
              <span className="ml-1 text-xs bg-muted px-1.5 py-0.5 rounded-full">
                {joinedTournamentIds.size}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="available">
            {/* Results Count */}
            <div className="flex items-center justify-between my-4">
              <p className="text-sm text-muted-foreground">
                {availableTournaments.length} available tournament
                {availableTournaments.length !== 1 ? "s" : ""}
              </p>
            </div>

            {/* Tournament Grid or Empty State */}
            {availableTournaments.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {availableTournaments.map((tournament) => (
                  <TournamentCard 
                    key={tournament.id} 
                    tournament={tournament}
                    onQuickJoin={tournament.status === "registration_open" ? () => handleQuickJoin(tournament) : undefined}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                hasFilters={!!(searchValue || selectedStatus || selectedGameType || entryFeeFilter.type !== "all")}
                onReset={handleReset}
              />
            )}
          </TabsContent>

          <TabsContent value="joined">
            {/* Results Count */}
            <div className="flex items-center justify-between my-4">
              <p className="text-sm text-muted-foreground">
                {joinedTournaments.length} joined tournament
                {joinedTournaments.length !== 1 ? "s" : ""}
              </p>
            </div>

            {/* Tournament Grid or Empty State */}
            {joinedTournaments.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {joinedTournaments.map((tournament) => (
                  <TournamentCard 
                    key={tournament.id} 
                    tournament={tournament}
                    isJoined={true}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                hasFilters={!!(searchValue || selectedStatus || selectedGameType || entryFeeFilter.type !== "all")}
                onReset={handleReset}
                isJoined={true}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Quick Join Modal */}
      {quickJoinTournament && (
        <QuickJoinModal
          tournament={quickJoinTournament}
          isOpen={!!quickJoinTournament}
          onClose={() => setQuickJoinTournament(null)}
          onConfirm={handleConfirmJoin}
        />
      )}
    </div>
  );
}

// Empty State Component
function EmptyState({ 
  hasFilters, 
  onReset,
  isJoined = false 
}: { 
  hasFilters: boolean; 
  onReset: () => void;
  isJoined?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <h3 className="text-lg font-semibold text-foreground mb-2">
        {isJoined ? "No joined tournaments" : "No tournaments found"}
      </h3>
      <p className="text-muted-foreground mb-4">
        {isJoined 
          ? "You haven't joined any tournaments yet"
          : hasFilters 
            ? "Try adjusting your search or filters"
            : "No tournaments are currently available"
        }
      </p>
      {hasFilters && (
        <Button
          onClick={onReset}
          variant="ghost"
          size="sm"
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium text-sm"
        >
          Reset filters
        </Button>
      )}
    </div>
  );
}
