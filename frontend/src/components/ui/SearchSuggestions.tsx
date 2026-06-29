"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Clock, X, Search } from "lucide-react";

interface SearchSuggestionsProps {
  suggestions: string[];
  searchHistory: string[];
  query: string;
  onSelectSuggestion: (suggestion: string) => void;
  onClearHistory: () => void;
  onRemoveFromHistory: (item: string) => void;
  isLoading?: boolean;
  className?: string;
}

export function SearchSuggestions({
  suggestions,
  searchHistory,
  query,
  onSelectSuggestion,
  onClearHistory,
  onRemoveFromHistory,
  isLoading = false,
  className,
}: SearchSuggestionsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Open when there are suggestions or history
  useEffect(() => {
    setIsOpen(suggestions.length > 0 || (searchHistory.length > 0 && query.length === 0));
  }, [suggestions, searchHistory, query]);

  if (!isOpen) return null;

  const hasSuggestions = suggestions.length > 0;
  const hasHistory = searchHistory.length > 0 && query.length === 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute top-full left-0 right-0 mt-2 bg-background border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto",
        className
      )}
    >
      {isLoading && (
        <div className="p-4 text-center text-muted-foreground">
          <div className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent" />
          <span className="ml-2">Searching...</span>
        </div>
      )}

      {!isLoading && hasSuggestions && (
        <div className="p-2">
          <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Suggestions
          </p>
          {suggestions.map((suggestion, index) => (
            <button
              key={`suggestion-${index}`}
              onClick={() => {
                onSelectSuggestion(suggestion);
                setIsOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-md flex items-center gap-2 transition-colors"
            >
              <Search className="h-4 w-4 text-muted-foreground" />
              <span>{suggestion}</span>
            </button>
          ))}
        </div>
      )}

      {!isLoading && hasHistory && (
        <div className="p-2 border-t">
          <div className="flex items-center justify-between px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Recent Searches
            </p>
            <button
              onClick={onClearHistory}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear all
            </button>
          </div>
          {searchHistory.map((item, index) => (
            <button
              key={`history-${index}`}
              onClick={() => {
                onSelectSuggestion(item);
                setIsOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-muted rounded-md flex items-center justify-between group transition-colors"
            >
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>{item}</span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFromHistory(item);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all"
              >
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </button>
          ))}
        </div>
      )}

      {!isLoading && !hasSuggestions && !hasHistory && (
        <div className="p-4 text-center text-sm text-muted-foreground">
          No suggestions found
        </div>
      )}
    </div>
  );
}
