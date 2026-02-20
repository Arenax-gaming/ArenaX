import React from "react";
import { TournamentStatus } from "@/types/tournament";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { X, Zap } from "lucide-react";

// Entry fee filter types
export type EntryFeeFilter = 
  | { type: "all" }
  | { type: "free" }
  | { type: "paid" }
  | { type: "custom"; min: number; max: number };

interface TournamentFilterProps {
  onSearchChange: (search: string) => void;
  onStatusChange: (status: TournamentStatus | null) => void;
  onGameTypeChange: (gameType: string | null) => void;
  searchValue: string;
  selectedStatus: TournamentStatus | null;
  selectedGameType: string | null;
  availableGameTypes: string[];
  onReset: () => void;
  // New Entry Fee filter props
  entryFeeFilter?: EntryFeeFilter;
  onEntryFeeChange?: (filter: EntryFeeFilter) => void;
}

const statuses: Array<{ value: TournamentStatus; label: string }> = [
  { value: "registration_open", label: "Registration Open" },
  { value: "in_progress", label: "Ongoing" },
  { value: "completed", label: "Completed" },
];

// Entry fee options
const entryFeeOptions: Array<{ 
  value: EntryFeeFilter; 
  label: string;
  icon?: React.ReactNode;
}> = [
  { value: { type: "all" }, label: "All" },
  { value: { type: "free" }, label: "Free", icon: <Zap className="h-3 w-3" /> },
  { value: { type: "paid" }, label: "Paid" },
];

export function TournamentFilter({
  onSearchChange,
  onStatusChange,
  onGameTypeChange,
  searchValue,
  selectedStatus,
  selectedGameType,
  availableGameTypes,
  onReset,
  entryFeeFilter = { type: "all" },
  onEntryFeeChange,
}: TournamentFilterProps) {
  // Check if entry fee filter is active
  const isEntryFeeFilterActive = entryFeeFilter.type !== "all";
  
  const hasActiveFilters = 
    searchValue || 
    selectedStatus || 
    selectedGameType || 
    isEntryFeeFilterActive;

  // Check if custom range is active
  const isCustomRange = entryFeeFilter.type === "custom";

  // Handle entry fee filter change
  const handleEntryFeeChange = (filter: EntryFeeFilter) => {
    onEntryFeeChange?.(filter);
  };

  // Handle custom range change
  const handleCustomRangeChange = (field: "min" | "max", value: string) => {
    const numValue = parseFloat(value) || 0;
    if (entryFeeFilter.type === "custom") {
      onEntryFeeChange?.({
        type: "custom",
        min: field === "min" ? numValue : entryFeeFilter.min,
        max: field === "max" ? numValue : entryFeeFilter.max,
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div>
        <Input
          placeholder="Search tournaments by name..."
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full"
        />
      </div>

      {/* Filters Container */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Status Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Status</label>
          <div className="space-y-2">
            <button
              onClick={() => onStatusChange(null)}
              className={`w-full px-3 py-2 rounded-md text-sm font-medium text-left transition-colors ${
                selectedStatus === null
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All
            </button>
            {statuses.map((status) => (
              <button
                key={status.value}
                onClick={() =>
                  onStatusChange(
                    selectedStatus === status.value ? null : status.value,
                  )
                }
                className={`w-full px-3 py-2 rounded-md text-sm font-medium text-left transition-colors ${
                  selectedStatus === status.value
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>

        {/* Game Type Filter */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            Game Type
          </label>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            <button
              onClick={() => onGameTypeChange(null)}
              className={`w-full px-3 py-2 rounded-md text-sm font-medium text-left transition-colors ${
                selectedGameType === null
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              All
            </button>
            {availableGameTypes.map((gameType) => (
              <button
                key={gameType}
                onClick={() =>
                  onGameTypeChange(
                    selectedGameType === gameType ? null : gameType,
                  )
                }
                className={`w-full px-3 py-2 rounded-md text-sm font-medium text-left transition-colors ${
                  selectedGameType === gameType
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {gameType}
              </button>
            ))}
          </div>
        </div>

        {/* Entry Fee Filter - NEW */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Entry Fee
          </label>
          <div className="space-y-2">
            {entryFeeOptions.map((option) => (
              <button
                key={option.label}
                onClick={() => handleEntryFeeChange(option.value)}
                className={`w-full px-3 py-2 rounded-md text-sm font-medium text-left transition-colors flex items-center gap-2 ${
                  entryFeeFilter.type === option.value.type &&
                  !isCustomRange
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
            
            {/* Custom Range Toggle */}
            <button
              onClick={() => 
                handleEntryFeeChange(
                  isCustomRange 
                    ? { type: "all" } 
                    : { type: "custom", min: 0, max: 1000 }
                )
              }
              className={`w-full px-3 py-2 rounded-md text-sm font-medium text-left transition-colors ${
                isCustomRange
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              Custom Range
            </button>

            {/* Custom Range Inputs */}
            {isCustomRange && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="text-xs text-muted-foreground">Min</label>
                  <Input
                    type="number"
                    min="0"
                    value={entryFeeFilter.type === "custom" ? entryFeeFilter.min : 0}
                    onChange={(e) => handleCustomRangeChange("min", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="Min"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Max</label>
                  <Input
                    type="number"
                    min="0"
                    value={entryFeeFilter.type === "custom" ? entryFeeFilter.max : 1000}
                    onChange={(e) => handleCustomRangeChange("max", e.target.value)}
                    className="h-8 text-sm"
                    placeholder="Max"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Results Count and Reset */}
        <div className="flex flex-col justify-end">
          {hasActiveFilters && (
            <Button
              variant="outline"
              size="md"
              onClick={onReset}
              className="w-full gap-2"
            >
              <X className="h-4 w-4" />
              Reset Filters
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
