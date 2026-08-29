"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { MatchWithPlayers } from "@/types/match";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { VirtualDynamicList, VirtualDynamicListRenderProps } from "@/components/ui/VirtualDynamicList";
import { useInfiniteScrollSentinel } from "@/hooks/useInfiniteScrollSentinel";
import {
  Trophy,
  Swords,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  Search,
  TrendingUp,
  TrendingDown,
  Clock,
  Gamepad2,
  BarChart3,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Allow either the profile-specific or general MatchWithPlayers shape
type AnyMatchWithPlayers = MatchWithPlayers & {
  scorePlayer1?: number;
  scorePlayer2?: number;
  createdAt?: string;
  completedAt?: string;
  /** Legacy profile-shape field — split as "playerScore-opponentScore". */
  score?: string;
  /** Legacy profile-shape field — ISO date of the match. */
  date?: string;
};

export interface MatchHistoryFilters {
  gameType?: string;
  result?: "win" | "loss";
  opponentSearch?: string;
  timeRange?: "week" | "month" | "all";
  field?: "date" | "elo" | "duration";
  direction?: "asc" | "desc";
}

export interface MatchHistorySort {
  field?: "date" | "elo" | "duration";
  direction?: "asc" | "desc";
}

interface MatchHistoryProps {
  matches: AnyMatchWithPlayers[];
  currentUserId: string;
  filters?: MatchHistoryFilters;
  onFilterChange?: (filters: MatchHistoryFilters) => void;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  /** Pixel height of the virtual scroll area. Defaults to 560. */
  virtualHeight?: number;
  /** Called when the user scrolls near the bottom */
  onLoadMore?: () => void;
  /** Show spinner while loading more */
  isLoadingMore?: boolean;
  /** Disable virtual scrolling (e.g. for short lists < 20 items) */
  disableVirtualization?: boolean;
  /**
   * Enable IntersectionObserver-driven infinite scroll (issue #888). When
   * omitted it turns on automatically if `onLoadMore` is supplied without
   * explicit pagination (`page`/`totalPages`), and off otherwise — so existing
   * paginated/virtualized call sites keep their behavior.
   */
  infiniteScroll?: boolean;
  /**
   * Whether more matches remain to load. Defaults to `true` in infinite-scroll
   * mode (or `page < totalPages` when paginating). Set to `false` to stop the
   * sentinel and show an end-of-list marker.
   */
  hasMore?: boolean;
  /** Elapsed ms for each infinite-scroll batch (acceptance criteria: < 300ms). */
  onBatchLoad?: (durationMs: number) => void;
  /**
   * sessionStorage key for scroll-position restoration across navigation.
   * Defaults to a stable key in infinite-scroll mode; pass `null` to disable.
   */
  scrollRestorationKey?: string | null;
}

// ─── Individual match row ─────────────────────────────────────────────────────

interface MatchRowProps {
  match: AnyMatchWithPlayers;
  currentUserId: string;
  index: number;
  measureRef?: (node: HTMLElement | null) => void;
  style?: React.CSSProperties;
}

const MatchRow = React.memo(function MatchRow({
  match,
  currentUserId,
  measureRef,
  style,
}: MatchRowProps) {
  const isWinner = match.winnerId === currentUserId;
  const opponentName =
    match.player1Id === currentUserId ? match.player2Username : match.player1Username;
  const myScore = match.score?.split("-")[0] ?? String(match.scorePlayer1 ?? 0);
  const opponentScore = match.score?.split("-")[1] ?? String(match.scorePlayer2 ?? 0);
  const date = new Date(match.date ?? match.createdAt ?? Date.now());
  const durationMinutes = useMemo(() => {
    const start = new Date(match.date ?? match.createdAt ?? Date.now());
    const end = new Date(match.completedAt ?? Date.now());
    return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
  }, [match.completedAt, match.date, match.createdAt]);

  // Deterministic ELO change based on match id to avoid hydration mismatch
  const eloSeed = match.id.charCodeAt(0) % 25 + 10;
  const eloChange = isWinner ? eloSeed : -eloSeed;

  return (
    <div style={style} role="listitem">
      <div ref={measureRef} className="px-1 py-1.5">
        <Link href={`/matches/${match.id}`} className="block">
          <div className="flex items-center justify-between p-4 bg-muted/40 rounded-lg border hover:bg-muted/60 transition-all duration-200 hover:shadow-md cursor-pointer group">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "flex items-center justify-center h-12 w-12 rounded-full font-bold text-sm shrink-0",
                  isWinner
                    ? "bg-success-muted text-green-700 dark:bg-success-muted/40 dark:text-success/80 border-2 border-success/30"
                    : "bg-destructive/10 text-red-700 dark:bg-destructive/20 dark:text-destructive/80 border-2 border-red-200 dark:border-red-800"
                )}
                aria-label={isWinner ? "Win" : "Loss"}
              >
                {isWinner ? "W" : "L"}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-foreground truncate">
                    vs {opponentName}
                  </span>
                  {match.tournamentName && (
                    <span className="text-xs text-muted-foreground inline-flex items-center gap-1 bg-yellow-100 dark:bg-yellow-900/30 px-2 py-0.5 rounded-full">
                      <Trophy className="h-3 w-3" aria-hidden="true" />
                      {match.tournamentName}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" aria-hidden="true" />
                    {date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year:
                        date.getFullYear() !== new Date().getFullYear()
                          ? "numeric"
                          : undefined,
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {date.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {durationMinutes > 0 && <span className="opacity-70">({durationMinutes}m)</span>}
                  </span>
                  <span className="uppercase tracking-wider font-medium bg-muted px-2 py-0.5 rounded">
                    {match.gameType}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <div className="text-right">
                <div className="text-xl font-bold tabular-nums mb-1">
                  {myScore} - {opponentScore}
                </div>
                <div
                  className={cn(
                    "text-xs font-medium flex items-center gap-1",
                    eloChange > 0 ? "text-success" : "text-destructive"
                  )}
                >
                  {eloChange > 0 ? (
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="h-3 w-3" aria-hidden="true" />
                  )}
                  {eloChange > 0 ? "+" : ""}
                  {eloChange} ELO
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
});

// ─── Main component ───────────────────────────────────────────────────────────

// De-duplicate matches by id, preserving first-seen order. Infinite scroll can
// re-deliver overlapping items across page boundaries; this keeps React keys
// unique and prevents the same match rendering twice.
function dedupeById(matches: AnyMatchWithPlayers[]): AnyMatchWithPlayers[] {
  const seen = new Set<string>();
  const out: AnyMatchWithPlayers[] = [];
  for (const match of matches) {
    if (match?.id == null || seen.has(match.id)) continue;
    seen.add(match.id);
    out.push(match);
  }
  return out;
}

// Parse URL search params into filters object
function parseFiltersFromURL(
  searchParams: { get(name: string): string | null } | null | undefined
): MatchHistoryFilters & MatchHistorySort {
  const filters: MatchHistoryFilters & MatchHistorySort = {};
  if (!searchParams) return filters;
  
  const gameType = searchParams.get("gameType");
  if (gameType) filters.gameType = gameType;
  
  const result = searchParams.get("result") as "win" | "loss" | undefined;
  if (result) filters.result = result;
  
  const opponentSearch = searchParams.get("opponentSearch");
  if (opponentSearch) filters.opponentSearch = opponentSearch;
  
  const timeRange = searchParams.get("timeRange") as "week" | "month" | "all" | undefined;
  if (timeRange) filters.timeRange = timeRange;
  
  const sortField = searchParams.get("sortField");
  if (sortField) filters.field = sortField as "date" | "elo" | "duration";
  
  const sortDirection = searchParams.get("sortDirection");
  if (sortDirection) filters.direction = sortDirection as "asc" | "desc";
  
  return filters;
}

// Build search params string from filters
function buildSearchParamsString(
  filters: MatchHistoryFilters & MatchHistorySort,
  router: any,
  pathname: string | null
) {
  const params = new URLSearchParams();
  
  if (filters.gameType) params.set("gameType", filters.gameType);
  if (filters.result) params.set("result", filters.result);
  if (filters.opponentSearch) params.set("opponentSearch", filters.opponentSearch);
  if (filters.timeRange) params.set("timeRange", filters.timeRange);
  if (filters.field) params.set("sortField", filters.field);
  if (filters.direction) params.set("sortDirection", filters.direction);
  
  const path = pathname ?? "";
  const queryString = params.toString();
  if (queryString) {
    router.push(`${path}?${queryString}`, { scroll: false });
  } else {
    router.push(path, { scroll: false });
  }
}

export function MatchHistory({
  matches,
  currentUserId,
  filters = {},
  onFilterChange,
  page,
  totalPages,
  onPageChange,
  virtualHeight = 560,
  onLoadMore,
  isLoadingMore = false,
  disableVirtualization = false,
  infiniteScroll,
  hasMore,
  onBatchLoad,
  scrollRestorationKey,
}: MatchHistoryProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  
  const [showFilters, setShowFilters] = useState(false);

  // Merge URL filters with props filters (props take precedence)
  const urlFilters = useMemo(() => parseFiltersFromURL(searchParams), [searchParams]);
  const activeFilters = { ...urlFilters, ...filters };
  
  // Handle filter changes - update both local state and URL
  const handleFilterChange = useCallback(
    (newFilters: MatchHistoryFilters) => {
      // If we have a callback, use it
      if (onFilterChange) {
        onFilterChange(newFilters);
      }
      // Update URL
      buildSearchParamsString({ ...activeFilters, ...newFilters }, router, pathname);
    },
    [onFilterChange, activeFilters, router, pathname]
  );

  // Overlapping pages can arrive with duplicate ids — dedupe before anything
  // else so counts, filters, and keys all operate on a clean list.
  const uniqueMatches = useMemo(() => dedupeById(matches), [matches]);

  const gameTypes = useMemo(
    () => Array.from(new Set(uniqueMatches.map((m) => m.gameType).filter(Boolean))),
    [uniqueMatches]
  );

  const filteredMatches = useMemo(() => {
    let result = uniqueMatches.filter((match) => {
      const isWin = match.winnerId === currentUserId;
      const opponentName =
        match.player1Id === currentUserId ? match.player2Username : match.player1Username;
      if (activeFilters.gameType && match.gameType !== activeFilters.gameType) return false;
      if (activeFilters.result === "win" && !isWin) return false;
      if (activeFilters.result === "loss" && isWin) return false;
      if (
        activeFilters.opponentSearch &&
        !opponentName.toLowerCase().includes(activeFilters.opponentSearch.toLowerCase())
      )
        return false;
      if (activeFilters.timeRange && activeFilters.timeRange !== "all") {
        const matchDate = new Date(match.date ?? match.createdAt ?? Date.now());
        const daysDiff = Math.floor(
          (Date.now() - matchDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (activeFilters.timeRange === "week" && daysDiff > 7) return false;
        if (activeFilters.timeRange === "month" && daysDiff > 30) return false;
      }
      return true;
    });

    // Apply sorting
    if (activeFilters.field) {
      result = [...result].sort((a, b) => {
        let comparison = 0;
        
        if (activeFilters.field === "date") {
          const dateA = new Date(a.date ?? a.createdAt ?? 0).getTime();
          const dateB = new Date(b.date ?? b.createdAt ?? 0).getTime();
          comparison = dateA - dateB;
        } else if (activeFilters.field === "elo") {
          // Calculate ELO change for both matches
          const eloSeedA = a.id.charCodeAt(0) % 25 + 10;
          const eloSeedB = b.id.charCodeAt(0) % 25 + 10;
          const eloA = a.winnerId === currentUserId ? eloSeedA : -eloSeedA;
          const eloB = b.winnerId === currentUserId ? eloSeedB : -eloSeedB;
          comparison = eloA - eloB;
        } else if (activeFilters.field === "duration") {
          const startA = new Date(a.date ?? a.createdAt ?? 0).getTime();
          const endA = new Date(a.completedAt ?? Date.now()).getTime();
          const durationA = endA - startA;
          
          const startB = new Date(b.date ?? b.createdAt ?? 0).getTime();
          const endB = new Date(b.completedAt ?? Date.now()).getTime();
          const durationB = endB - startB;
          
          comparison = durationA - durationB;
        }
        
        return activeFilters.direction === "asc" ? comparison : -comparison;
      });
    }

    return result;
  }, [uniqueMatches, activeFilters, currentUserId]);

  const wins = filteredMatches.filter((m) => m.winnerId === currentUserId).length;
  const losses = filteredMatches.length - wins;
  const winRate = filteredMatches.length > 0 ? (wins / filteredMatches.length) * 100 : 0;
  const hasActiveFilters = Object.values(activeFilters).some((v) => v !== undefined);

  const paginationProvided = totalPages !== undefined && onPageChange !== undefined;
  const currentPage = page ?? 1;

  // Infinite scroll turns on explicitly, or implicitly when a load callback is
  // supplied without pagination. It is mutually exclusive with the paginated /
  // virtualized paths (window-level scrolling vs. an inner fixed-height list).
  const useInfinite = infiniteScroll ?? (!!onLoadMore && !paginationProvided);
  const moreAvailable =
    hasMore ?? (paginationProvided ? currentPage < (totalPages ?? 1) : true);

  // Use virtualisation only when there are enough items to justify it and we are
  // not in infinite-scroll mode.
  const useVirtual =
    !useInfinite && !disableVirtualization && filteredMatches.length >= 20;

  const { sentinelRef } = useInfiniteScrollSentinel({
    onLoadMore,
    hasMore: moreAvailable,
    isLoading: isLoadingMore,
    itemCount: uniqueMatches.length,
    enabled: useInfinite,
    onBatchLoad,
  });

  // Restore the window scroll position when returning to this list (e.g. after
  // opening a match and navigating back), and persist it as the user scrolls.
  const restoreKey =
    scrollRestorationKey === undefined
      ? useInfinite
        ? "match-history"
        : null
      : scrollRestorationKey;

  useEffect(() => {
    if (!restoreKey || typeof window === "undefined") return;
    const storageKey = `mh-scroll:${restoreKey}`;
    const raf =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0);

    // Restore once the list has had a chance to lay out.
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      const y = saved ? parseInt(saved, 10) : NaN;
      if (!Number.isNaN(y) && typeof window.scrollTo === "function") {
        raf(() => window.scrollTo(0, y));
      }
    } catch {
      /* sessionStorage unavailable (private mode) — restoration is best-effort */
    }

    let frame = 0;
    const persist = () => {
      try {
        window.sessionStorage.setItem(storageKey, String(window.scrollY));
      } catch {
        /* ignore */
      }
    };
    const onScroll = () => {
      if (frame) return;
      frame = raf(() => {
        frame = 0;
        persist();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      persist();
    };
  }, [restoreKey]);

  const clearFilters = useCallback(() => {
    // Clear both local filters and URL
    buildSearchParamsString({}, router, pathname);
    if (onFilterChange) {
      onFilterChange({});
    }
  }, [router, pathname, onFilterChange]);

  // Render function for VirtualDynamicList
  const renderMatchItem = useCallback(
    ({ item, index, style, measureRef }: VirtualDynamicListRenderProps<AnyMatchWithPlayers>) => (
      <MatchRow
        key={item.id}
        match={item}
        currentUserId={currentUserId}
        index={index}
        style={style}
        measureRef={measureRef}
      />
    ),
    [currentUserId]
  );

  const showPagination =
    !useInfinite && totalPages !== undefined && onPageChange !== undefined && totalPages > 1;

  // Helper to toggle sort
  const toggleSort = useCallback(
    (field: "date" | "elo" | "duration") => {
      const currentField = activeFilters.field;
      const currentDirection = activeFilters.direction;
      
      let newDirection: "asc" | "desc" = "desc";
      if (currentField === field) {
        newDirection = currentDirection === "asc" ? "desc" : "asc";
      }
      
      handleFilterChange({ field, direction: newDirection });
    },
    [activeFilters.field, activeFilters.direction, handleFilterChange]
  );

  // Get sort indicator icon
  const getSortIndicator = (field: "date" | "elo" | "duration") => {
    if (activeFilters.field !== field) return null;
    return activeFilters.direction === "asc" ? (
      <span className="ml-1 text-xs">▲</span>
    ) : (
      <span className="ml-1 text-xs">▼</span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Swords className="h-5 w-5" aria-hidden="true" />
            Match History
            {filteredMatches.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                ({filteredMatches.length} matches)
              </span>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(hasActiveFilters && "border-primary")}
            aria-expanded={showFilters}
            aria-controls="match-history-filters"
          >
            <Filter className="h-4 w-4 mr-2" aria-hidden="true" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 bg-primary text-primary-foreground rounded-full w-2 h-2" aria-hidden="true" />
            )}
          </Button>
        </div>

        {/* Stats summary */}
        {filteredMatches.length > 0 && (
          <div className="grid grid-cols-3 gap-4 pt-4 border-t" role="region" aria-label="Match statistics">
            <div className="text-center">
              <p className="text-2xl font-bold text-success" aria-label={`${wins} wins`}>{wins}</p>
              <p className="text-xs text-muted-foreground">Wins</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-destructive" aria-label={`${losses} losses`}>{losses}</p>
              <p className="text-xs text-muted-foreground">Losses</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{winRate.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground">Win Rate</p>
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {/* Filter controls */}
        {showFilters && (
          <div
            id="match-history-filters"
            className="space-y-4 mb-6 p-4 bg-muted/30 rounded-lg border"
            role="region"
            aria-label="Match filters"
          >
            {/* Sort options */}
            <div className="space-y-2">
              <span className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Sort By
              </span>
              <div className="flex flex-wrap gap-2">
                {(["date", "elo", "duration"] as const).map((field) => (
                  <button
                    key={field}
                    onClick={() => toggleSort(field)}
                    className={cn(
                      "flex items-center px-3 py-1.5 text-sm rounded-md border transition-all",
                      activeFilters.field === field
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground hover:bg-muted border-muted-foreground/20"
                    )}
                    aria-pressed={activeFilters.field === field}
                  >
                    {field === "date" && <Calendar className="h-3 w-3 mr-1.5" />}
                    {field === "elo" && (
                      <>
                        <TrendingUp className="h-3 w-3 mr-1.5" />
                        <span>ELO</span>
                      </>
                    )}
                    {field === "duration" && <Clock className="h-3 w-3 mr-1.5" />}
                    <span className="capitalize">{field}</span>
                    {getSortIndicator(field)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {/* Time Range */}
              <div className="flex rounded-md overflow-hidden border" role="group" aria-label="Filter by time range">
                {(["all", "week", "month"] as const).map((range) => {
                  const active = (activeFilters.timeRange ?? "all") === range;
                  return (
                    <button
                      key={range}
                      onClick={() => handleFilterChange({ timeRange: range })}
                      className={cn(
                        "px-3 py-1.5 text-sm capitalize transition-colors",
                        active ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted"
                      )}
                      aria-pressed={active}
                    >
                      {range === "all" ? "All Time" : `Past ${range}`}
                    </button>
                  );
                })}
              </div>

              {/* Game type */}
              <select
                value={activeFilters.gameType ?? ""}
                onChange={(e) => handleFilterChange({ gameType: e.target.value || undefined })}
                className="text-sm border rounded-md px-3 py-1.5 bg-background text-foreground min-w-[120px]"
                aria-label="Filter by game type"
              >
                <option value="">All Types</option>
                {gameTypes.map((gt) => (
                  <option key={gt} value={gt}>{gt}</option>
                ))}
              </select>

              {/* Result */}
              <div className="flex rounded-md overflow-hidden border" role="group" aria-label="Filter by result">
                {(["all", "win", "loss"] as const).map((r) => {
                  const active = r === "all" ? !activeFilters.result : activeFilters.result === r;
                  return (
                    <button
                      key={r}
                      onClick={() => handleFilterChange({ result: r === "all" ? undefined : r })}
                      className={cn(
                        "px-3 py-1.5 text-sm capitalize transition-colors",
                        active ? "bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-muted"
                      )}
                      aria-pressed={active}
                    >
                      {r === "all" ? "All" : r === "win" ? "Wins" : "Losses"}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Opponent search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search opponent..."
                value={activeFilters.opponentSearch ?? ""}
                onChange={(e) => handleFilterChange({ opponentSearch: e.target.value || undefined })}
                className="w-full pl-10 pr-4 py-2 text-sm border rounded-md bg-background text-foreground"
                aria-label="Search by opponent name"
              />
              {activeFilters.opponentSearch && (
                <button
                  onClick={() => handleFilterChange({ opponentSearch: undefined })}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear opponent search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {hasActiveFilters && (
              <div className="flex justify-end pt-2">
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X className="h-4 w-4 mr-2" />
                  Clear All Filters
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Match list */}
        {filteredMatches.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <Gamepad2 className="h-12 w-12 text-muted-foreground opacity-50" aria-hidden="true" />
            <h3 className="text-lg font-semibold">No matches found</h3>
            <p className="text-muted-foreground text-sm max-w-md">
              {hasActiveFilters
                ? "Try adjusting your filters to see more matches"
                : "You haven't played any matches yet. Start competing to build your history!"}
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : useVirtual ? (
          <VirtualDynamicList
            listId="match-history"
            items={filteredMatches}
            estimatedItemSize={88}
            height={virtualHeight}
            overscanCount={3}
            renderItem={renderMatchItem}
            onLoadMore={onLoadMore}
            loadingIndicator={
              isLoadingMore ? (
                <div className="flex justify-center py-3 border-t" aria-busy="true">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : null
            }
          />
        ) : useInfinite ? (
          // Infinite scroll: window-level list with an IntersectionObserver
          // sentinel that requests the next batch as it nears the viewport.
          <div className="space-y-3" role="list" aria-busy={isLoadingMore}>
            {filteredMatches.map((match, index) => (
              <MatchRow
                key={match.id}
                match={match}
                currentUserId={currentUserId}
                index={index}
              />
            ))}

            {isLoadingMore && (
              <div
                className="flex justify-center py-3"
                aria-busy="true"
                aria-label="Loading more matches"
              >
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            )}

            {/* Sentinel: kept in the tree (not the spinner) so the observer has a
                stable target. Zero-height and hidden from assistive tech. */}
            {moreAvailable && (
              <div
                ref={sentinelRef}
                data-testid="infinite-scroll-sentinel"
                aria-hidden="true"
                className="h-px w-full"
              />
            )}

            {!moreAvailable && (
              <p className="text-center text-xs text-muted-foreground py-3">
                You&apos;ve reached the end of your match history
              </p>
            )}
          </div>
        ) : (
          // Static render for short lists
          <div className="space-y-3" role="list">
            {filteredMatches.map((match, index) => (
              <MatchRow
                key={match.id}
                match={match}
                currentUserId={currentUserId}
                index={index}
              />
            ))}
          </div>
        )}

        {/* Pagination (used alongside non-virtual render) */}
        {paginationProvided && !useVirtual && (
          <div className="flex items-center justify-center gap-3 mt-6 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4 mr-1" aria-hidden="true" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground px-4">
              Page {currentPage} of {totalPages ?? 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(currentPage + 1)}
              disabled={totalPages !== undefined && currentPage >= totalPages}
              aria-label="Next page"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" aria-hidden="true" />
            </Button>
          </div>
        )}

        {filteredMatches.length > 0 && (
          <div className="flex justify-center mt-6 pt-4 border-t">
            <Link href="/matches">
              <Button variant="outline" size="sm">
                <BarChart3 className="h-4 w-4 mr-2" aria-hidden="true" />
                View Detailed Analytics
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
