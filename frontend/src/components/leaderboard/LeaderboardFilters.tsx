"use client";

import React, { useState } from "react";
import { Search, X } from "lucide-react";

interface LeaderboardFiltersProps {
  onSearch?: (query: string) => void;
  onFilterChange?: (filters: FilterState) => void;
}

export interface FilterState {
  searchQuery: string;
  minRank?: number;
  maxRank?: number;
  minWinRate?: number;
}

export const LeaderboardFilters: React.FC<LeaderboardFiltersProps> = ({
  onSearch,
  onFilterChange,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [minWinRate, setMinWinRate] = useState(0);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    onSearch?.(value);
  };

  const handleFilterChange = () => {
    onFilterChange?.({
      searchQuery,
      minWinRate: minWinRate > 0 ? minWinRate : undefined,
    });
  };

  const handleClear = () => {
    setSearchQuery("");
    setMinWinRate(0);
    onSearch?.("");
    onFilterChange?.({ searchQuery: "" });
  };

  return (
    <div className="space-y-4">
      {/* Search Bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          placeholder="Search players..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full pl-10 pr-10 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
        />
        {searchQuery && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Advanced Filters Toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
      >
        {showAdvanced ? "Hide" : "Show"} Advanced Filters
      </button>

      {/* Advanced Filters */}
      {showAdvanced && (
        <div className="bg-gray-800/50 rounded-lg p-4 space-y-4 border border-gray-700">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Minimum Win Rate: {minWinRate}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={minWinRate}
              onChange={(e) => setMinWinRate(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <button
            onClick={handleFilterChange}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition-colors"
          >
            Apply Filters
          </button>
        </div>
      )}
    </div>
  );
};
