"use client";

import { useState, useMemo } from "react";
import { TournamentCard } from "@/components/tournaments/TournamentCard";
import { TournamentFilter } from "@/components/tournaments/TournamentFilter";
import { Tournament, TournamentStatus } from "@/types/tournament";
import { mockTournaments } from "@/data/mockTournaments";
import { AppLayout } from "@/components/layout/AppLayout";

export default function TournamentsPage() {
  // Search and filter state
  const [searchValue, setSearchValue] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<TournamentStatus | null>(null);
  const [selectedGameType, setSelectedGameType] = useState<string | null>(null);

  // Example: Entry fee & sort filters
  const [entryFeeFilter, setEntryFeeFilter] = useState<{ type: string }>({ type: "all" });
  const [sortOption, setSortOption] = useState<{ type: string }>({ type: "newest" });

  // Quick join state
  const [quickJoinTournament, setQuickJoinTournament] = useState<Tournament | null>(null);
  const [joinedTournamentIds, setJoinedTournamentIds] = useState<Set<string>>(new Set());

  // Get unique game types from tournaments
  const availableGameTypes = useMemo(() => {
    const types = new Set(mockTournaments.map((t) => t.gameType));
    return Array.from(types).sort();
  }, []);

  // Filter tournaments based on search and filters
  const filteredTournaments = useMemo(() => {
    return mockTournaments.filter((tournament) => {
      const searchLower = searchValue.toLowerCase();
      const matchesSearch =
        tournament.name.toLowerCase().includes(searchLower) ||
        tournament.gameType.toLowerCase().includes(searchLower) ||
        (tournament.description?.toLowerCase().includes(searchLower) ?? false);

      const matchesStatus =
        !selectedStatus || tournament.status === selectedStatus;

      const matchesGameType =
        !selectedGameType || tournament.gameType === selectedGameType;

      return matchesSearch && matchesStatus && matchesGameType;
    });
  }, [searchValue, selectedStatus, selectedGameType]);

  // Reset filters
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

    setJoinedTournamentIds((prev) => {
      const newSet = new Set(prev);
      newSet.add(quickJoinTournament.id);
      return newSet;
    });

    return true;
  };

  return (
    <AppLayout>
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
        />

        {/* Results Count */}
        <div className="flex items-center justify-between my-4">
          <p className="text-sm text-muted-foreground">
            {filteredTournaments.length} tournament
            {filteredTournaments.length !== 1 ? "s" : ""} found
          </p>
        </div>

        {/* Tournament Grid */}
        {filteredTournaments.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredTournaments.map((tournament) => (
              <TournamentCard
                key={tournament.id}
                tournament={tournament}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                No tournaments found
              </h3>
              <p className="text-muted-foreground mb-4">
                {searchValue || selectedStatus || selectedGameType
                  ? "Try adjusting your search or filters"
                  : "No tournaments are currently available"}
              </p>
              {(searchValue || selectedStatus || selectedGameType) && (
                <button
                  onClick={handleReset}
                  className="text-blue-600 hover:text-blue-700 font-medium text-sm"
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}