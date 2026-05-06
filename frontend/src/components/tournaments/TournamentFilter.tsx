"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { TournamentStatus, TournamentType, TournamentFilters } from "@/types/tournament";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { X, ChevronDown, Filter, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const statuses: Array<{ value: TournamentStatus; label: string }> = [
  { value: "registration_open", label: "Registration Open" },
  { value: "in_progress", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "registration_closed", label: "Registration Closed" },
];

const tournamentFormats: Array<{ value: TournamentType; label: string }> = [
  { value: "single_elimination", label: "Single Elimination" },
  { value: "double_elimination", label: "Double Elimination" },
  { value: "round_robin", label: "Round Robin" },
  { value: "swiss", label: "Swiss" },
];

const sortOptions: Array<{ value: TournamentFilters['sortBy']; label: string }> = [
  { value: "date", label: "Start Date" },
  { value: "prize_pool", label: "Prize Pool" },
  { value: "participants", label: "Participants" },
];

interface TournamentFilterProps {
  availableGameTypes: string[];
  onFiltersChange?: (filters: TournamentFilters) => void;
}

export function TournamentFilter({ availableGameTypes, onFiltersChange }: TournamentFilterProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // State for URL params
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [status, setStatus] = useState<TournamentStatus | null>(
    (searchParams.get("status") as TournamentStatus) || null
  );
  const [gameType, setGameType] = useState<string | null>(searchParams.get("gameType") || null);
  const [tournamentType, setTournamentType] = useState<TournamentType | null>(
    (searchParams.get("tournamentType") as TournamentType) || null
  );
  const [minEntryFee, setMinEntryFee] = useState(searchParams.get("minEntryFee") || "");
  const [maxEntryFee, setMaxEntryFee] = useState(searchParams.get("maxEntryFee") || "");
  const [minPrizePool, setMinPrizePool] = useState(searchParams.get("minPrizePool") || "");
  const [maxPrizePool, setMaxPrizePool] = useState(searchParams.get("maxPrizePool") || "");
  const [sortBy, setSortBy] = useState<TournamentFilters['sortBy']>(
    (searchParams.get("sortBy") as TournamentFilters['sortBy']) || "date"
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    (searchParams.get("sortOrder") as 'asc' | 'desc') || "desc"
  );

  // Dropdown states
  const [statusOpen, setStatusOpen] = useState(false);
  const [gameTypeOpen, setGameTypeOpen] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Update URL params when filters change
  const updateURL = useCallback(() => {
    const params = new URLSearchParams();

    if (debouncedSearch) params.set("search", debouncedSearch);
    if (status) params.set("status", status);
    if (gameType) params.set("gameType", gameType);
    if (tournamentType) params.set("tournamentType", tournamentType);
    if (minEntryFee) params.set("minEntryFee", minEntryFee);
    if (maxEntryFee) params.set("maxEntryFee", maxEntryFee);
    if (minPrizePool) params.set("minPrizePool", minPrizePool);
    if (maxPrizePool) params.set("maxPrizePool", maxPrizePool);
    if (sortBy) params.set("sortBy", sortBy);
    if (sortOrder) params.set("sortOrder", sortOrder);

    const queryString = params.toString();
    router.push(`/tournaments${queryString ? `?${queryString}` : ""}`, { scroll: false });

    // Notify parent of filter changes
    if (onFiltersChange) {
      onFiltersChange({
        search: debouncedSearch || undefined,
        status: status || undefined,
        gameType: gameType || undefined,
        tournamentType: tournamentType || undefined,
        minEntryFee: minEntryFee ? Number(minEntryFee) : undefined,
        maxEntryFee: maxEntryFee ? Number(maxEntryFee) : undefined,
        minPrizePool: minPrizePool ? Number(minPrizePool) : undefined,
        maxPrizePool: maxPrizePool ? Number(maxPrizePool) : undefined,
        sortBy,
        sortOrder,
      });
    }
  }, [debouncedSearch, status, gameType, tournamentType, minEntryFee, maxEntryFee, minPrizePool, maxPrizePool, sortBy, sortOrder, router, onFiltersChange]);

  useEffect(() => {
    updateURL();
  }, [updateURL]);

  // Clear all filters
  const clearAllFilters = () => {
    setSearch("");
    setStatus(null);
    setGameType(null);
    setTournamentType(null);
    setMinEntryFee("");
    setMaxEntryFee("");
    setMinPrizePool("");
    setMaxPrizePool("");
    setSortBy("date");
    setSortOrder("desc");
  };

  // Remove individual filter
  const removeFilter = (filter: string) => {
    switch (filter) {
      case "search":
        setSearch("");
        break;
      case "status":
        setStatus(null);
        break;
      case "gameType":
        setGameType(null);
        break;
      case "tournamentType":
        setTournamentType(null);
        break;
      case "entryFee":
        setMinEntryFee("");
        setMaxEntryFee("");
        break;
      case "prizePool":
        setMinPrizePool("");
        setMaxPrizePool("");
        break;
      case "sort":
        setSortBy("date");
        setSortOrder("desc");
        break;
    }
  };

  const hasActiveFilters = debouncedSearch || status || gameType || tournamentType || minEntryFee || maxEntryFee || minPrizePool || maxPrizePool || (sortBy !== "date" || sortOrder !== "desc");

  const activeFilters = [
    ...(debouncedSearch ? [{ key: "search", label: `Search: "${debouncedSearch}"` }] : []),
    ...(status ? [{ key: "status", label: `Status: ${statuses.find(s => s.value === status)?.label}` }] : []),
    ...(gameType ? [{ key: "gameType", label: `Game: ${gameType}` }] : []),
    ...(tournamentType ? [{ key: "tournamentType", label: `Format: ${tournamentFormats.find(f => f.value === tournamentType)?.label}` }] : []),
    ...(minEntryFee || maxEntryFee ? [{ key: "entryFee", label: `Entry Fee: ${minEntryFee || "0"}-${maxEntryFee || "∞"}` }] : []),
    ...(minPrizePool || maxPrizePool ? [{ key: "prizePool", label: `Prize Pool: ${minPrizePool || "0"}-${maxPrizePool || "∞"}` }] : []),
    ...((sortBy !== "date" || sortOrder !== "desc") ? [{ key: "sort", label: `Sort: ${sortOptions.find(s => s.value === sortBy)?.label} (${sortOrder})` }] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <Input
          placeholder="Search tournaments by name or game..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pr-10"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Active Filter Chips */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              onClick={() => removeFilter(filter.key)}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              {filter.label}
              <X className="h-3 w-3" />
            </button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-7 text-xs"
          >
            Clear all
          </Button>
        </div>
      )}

      {/* Filters Container */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Status Filter */}
        <Dropdown
          label="Status"
          isOpen={statusOpen}
          onOpenChange={setStatusOpen}
          value={status ? statuses.find(s => s.value === status)?.label : "All"}
        >
          <button
            onClick={() => { setStatus(null); setStatusOpen(false); }}
            className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted/80", !status && "bg-muted/50")}
          >
            All
          </button>
          {statuses.map((s) => (
            <button
              key={s.value}
              onClick={() => { setStatus(s.value); setStatusOpen(false); }}
              className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted/80", status === s.value && "bg-muted/50")}
            >
              {s.label}
            </button>
          ))}
        </Dropdown>

        {/* Game Type Filter */}
        <Dropdown
          label="Game"
          isOpen={gameTypeOpen}
          onOpenChange={setGameTypeOpen}
          value={gameType || "All"}
        >
          <button
            onClick={() => { setGameType(null); setGameTypeOpen(false); }}
            className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted/80", !gameType && "bg-muted/50")}
          >
            All
          </button>
          {availableGameTypes.map((gt) => (
            <button
              key={gt}
              onClick={() => { setGameType(gt); setGameTypeOpen(false); }}
              className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted/80", gameType === gt && "bg-muted/50")}
            >
              {gt}
            </button>
          ))}
        </Dropdown>

        {/* Tournament Format Filter */}
        <Dropdown
          label="Format"
          isOpen={formatOpen}
          onOpenChange={setFormatOpen}
          value={tournamentType ? tournamentFormats.find(f => f.value === tournamentType)?.label : "All"}
        >
          <button
            onClick={() => { setTournamentType(null); setFormatOpen(false); }}
            className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted/80", !tournamentType && "bg-muted/50")}
          >
            All
          </button>
          {tournamentFormats.map((tf) => (
            <button
              key={tf.value}
              onClick={() => { setTournamentType(tf.value); setFormatOpen(false); }}
              className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted/80", tournamentType === tf.value && "bg-muted/50")}
            >
              {tf.label}
            </button>
          ))}
        </Dropdown>

        {/* Entry Fee Range */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Entry Fee</label>
          <div className="flex gap-2">
            <Input
              placeholder="Min"
              type="number"
              value={minEntryFee}
              onChange={(e) => setMinEntryFee(e.target.value)}
              className="w-full"
            />
            <Input
              placeholder="Max"
              type="number"
              value={maxEntryFee}
              onChange={(e) => setMaxEntryFee(e.target.value)}
              className="w-full"
            />
          </div>
        </div>

        {/* Prize Pool Range */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Prize Pool</label>
          <div className="flex gap-2">
            <Input
              placeholder="Min"
              type="number"
              value={minPrizePool}
              onChange={(e) => setMinPrizePool(e.target.value)}
              className="w-full"
            />
            <Input
              placeholder="Max"
              type="number"
              value={maxPrizePool}
              onChange={(e) => setMaxPrizePool(e.target.value)}
              className="w-full"
            />
          </div>
        </div>

        {/* Sort */}
        <Dropdown
          label="Sort"
          isOpen={sortOpen}
          onOpenChange={setSortOpen}
          value={`${sortOptions.find(s => s.value === sortBy)?.label} (${sortOrder})`}
          icon={<ArrowUpDown className="h-4 w-4" />}
        >
          {sortOptions.map((option) => (
            <div key={option.value} className="space-y-1">
              <button
                onClick={() => { setSortBy(option.value); setSortOrder("asc"); setSortOpen(false); }}
                className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted/80 flex items-center justify-between", sortBy === option.value && sortOrder === "asc" && "bg-muted/50")}
              >
                {option.label}
                <span className="text-xs text-muted-foreground">Asc</span>
              </button>
              <button
                onClick={() => { setSortBy(option.value); setSortOrder("desc"); setSortOpen(false); }}
                className={cn("w-full px-3 py-2 text-left text-sm hover:bg-muted/80 flex items-center justify-between", sortBy === option.value && sortOrder === "desc" && "bg-muted/50")}
              >
                {option.label}
                <span className="text-xs text-muted-foreground">Desc</span>
              </button>
            </div>
          ))}
        </Dropdown>
      </div>
    </div>
  );
}

function Dropdown({ label, isOpen, onOpenChange, value, children, icon }: {
  label: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        onClick={() => onOpenChange(!isOpen)}
        className="w-full px-3 py-2 text-left text-sm bg-muted/50 hover:bg-muted/80 rounded-md flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-medium text-muted-foreground">{label}:</span>
          <span className="truncate">{value}</span>
        </div>
        <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-background border rounded-md shadow-lg max-h-64 overflow-y-auto">
          <div className="p-1">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
