import { useState, useCallback, useEffect, useRef } from 'react';

interface SearchOptions<T> {
  debounceMs?: number;
  cacheKey?: string;
  maxCacheSize?: number;
  maxHistorySize?: number;
  minSearchLength?: number;
}

interface SearchResult<T> {
  results: T[];
  timestamp: number;
  query: string;
}

interface UseSearchReturn<T> {
  query: string;
  setQuery: (query: string) => void;
  debouncedQuery: string;
  results: T[];
  isLoading: boolean;
  error: string | null;
  searchHistory: string[];
  clearHistory: () => void;
  removeFromHistory: (query: string) => void;
  suggestions: string[];
  clearCache: () => void;
  refetch: () => void;
}

/**
 * Advanced search hook with debouncing, caching, and history
 */
export function useSearch<T>(
  searchFn: (query: string) => Promise<T[]>,
  options: SearchOptions<T> = {}
): UseSearchReturn<T> {
  const {
    debounceMs = 300,
    cacheKey = 'search_cache',
    maxCacheSize = 50,
    maxHistorySize = 10,
    minSearchLength = 2,
  } = options;

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, debounceMs);
  const [results, setResults] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  
  const cacheRef = useRef<Map<string, SearchResult<T>>>(new Map());
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load search history from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`search_history_${cacheKey}`);
      if (saved) {
        setSearchHistory(JSON.parse(saved));
      }
    } catch {
      // Ignore storage errors
    }
  }, [cacheKey]);

  // Save search history to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(`search_history_${cacheKey}`, JSON.stringify(searchHistory));
    } catch {
      // Ignore storage errors
    }
  }, [searchHistory, cacheKey]);

  // Perform search when debounced query changes
  useEffect(() => {
    if (debouncedQuery.length < minSearchLength) {
      setResults([]);
      setSuggestions([]);
      return;
    }

    const performSearch = async () => {
      // Cancel previous request if still pending
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Check cache first
      const cached = cacheRef.current.get(debouncedQuery);
      if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) { // 5 min cache TTL
        setResults(cached.results);
        return;
      }

      setIsLoading(true);
      setError(null);
      abortControllerRef.current = new AbortController();

      try {
        const searchResults = await searchFn(debouncedQuery);
        setResults(searchResults);

        // Cache results
        cacheRef.current.set(debouncedQuery, {
          results: searchResults,
          timestamp: Date.now(),
          query: debouncedQuery,
        });

        // Limit cache size
        if (cacheRef.current.size > maxCacheSize) {
          const oldestKey = Array.from(cacheRef.current.keys())[0];
          cacheRef.current.delete(oldestKey);
        }

        // Add to search history (avoid duplicates and limit size)
        setSearchHistory((prev) => {
          const filtered = prev.filter((q) => q !== debouncedQuery);
          const updated = [debouncedQuery, ...filtered].slice(0, maxHistorySize);
          return updated;
        });

        // Generate suggestions from results (if they have a name/title property)
        const suggestionList = searchResults
          .slice(0, 5)
          .map((result) => {
            if (typeof result === 'object' && result !== null) {
              return (result as any).name || (result as any).title || (result as any).username || '';
            }
            return String(result);
          })
          .filter(Boolean);
        setSuggestions(suggestionList);

      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    };

    performSearch();
  }, [debouncedQuery, searchFn, minSearchLength, maxCacheSize, maxHistorySize]);

  const clearHistory = useCallback(() => {
    setSearchHistory([]);
    try {
      localStorage.removeItem(`search_history_${cacheKey}`);
    } catch {
      // Ignore storage errors
    }
  }, [cacheKey]);

  const removeFromHistory = useCallback((queryToRemove: string) => {
    setSearchHistory((prev) => prev.filter((q) => q !== queryToRemove));
  }, []);

  const clearCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  const refetch = useCallback(() => {
    if (debouncedQuery.length >= minSearchLength) {
      // Force cache invalidation by removing the entry
      cacheRef.current.delete(debouncedQuery);
      // The effect will re-run with the same query
    }
  }, [debouncedQuery, minSearchLength]);

  return {
    query,
    setQuery,
    debouncedQuery,
    results,
    isLoading,
    error,
    searchHistory,
    clearHistory,
    removeFromHistory,
    suggestions,
    clearCache,
    refetch,
  };
}

/**
 * Simple debounce hook
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
