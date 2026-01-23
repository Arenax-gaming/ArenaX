import React from "react";
import { TournamentStatus } from "@/types/tournament";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { X } from "lucide-react";

interface TournamentFilterProps {
  onSearchChange: (search: string) => void;
  onStatusChange: (status: TournamentStatus | null) => void;
  onGameTypeChange: (gameType: string | null) => void;
  searchValue: string;
  selectedStatus: TournamentStatus | null;
  selectedGameType: string | null;
  availableGameTypes: string[];
  onReset: () => void;
}

const statuses: Array<{ value: TournamentStatus; label: string }> = [
  { value: "registration_open", label: "Registration Open" },
  { value: "in_progress", label: "Ongoing" },
  { value: "completed", label: "Completed" },
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
}: TournamentFilterProps) {
  const hasActiveFilters = searchValue || selectedStatus || selectedGameType;

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
