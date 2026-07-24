"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Trophy, Loader2 } from "lucide-react";
import type { LeaderboardCategory } from "@/types/leaderboard";
import { useLeaderboard } from "@/hooks/useLeaderboard";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const CATEGORIES: { value: LeaderboardCategory; label: string }[] = [
  { value: "global", label: "Global" },
  { value: "ranked", label: "Ranked" },
  { value: "tournaments", label: "Tournaments" },
  { value: "casual", label: "Casual" },
];

const SEASONS: { id: string; label: string }[] = [
  { id: "current", label: "Current Season" },
  { id: "season-5", label: "Season 5" },
  { id: "season-4", label: "Season 4" },
  { id: "season-3", label: "Season 3" },
  { id: "season-2", label: "Season 2" },
  { id: "season-1", label: "Season 1" },
  { id: "all-time", label: "All Time" },
];

const SORT_COLUMNS = ["eloRating", "wins", "winRate", "matchesPlayed"] as const;
type SortColumn = (typeof SORT_COLUMNS)[number];

const SORT_LABELS: Record<SortColumn, string> = {
  eloRating: "ELO",
  wins: "Wins",
  winRate: "Win Rate",
  matchesPlayed: "Matches",
};

// Rank medal colours for top 3
const RANK_STYLES: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-300",
  2: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-300",
  3: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 border-orange-300",
};

// ---------------------------------------------------------------------------
// Pagination controls component
// ---------------------------------------------------------------------------
interface PaginationProps {
  page: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  totalCount: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  isLoading: boolean;
}

function Pagination({
  page,
  totalPages,
  rangeStart,
  rangeEnd,
  totalCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  isLoading,
}: PaginationProps) {
  // Build a compact page-number window: [1] … [page-1] [page] [page+1] … [last]
  const pageNumbers = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages: (number | "…")[] = [1];
    if (page > 3) pages.push("…");
    for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) {
      pages.push(p);
    }
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
    return pages;
  })();

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 text-sm">
      {/* Range summary */}
      <p className="text-muted-foreground shrink-0">
        {totalCount === 0
          ? "No players found"
          : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${totalCount.toLocaleString()} players`}
      </p>

      <div className="flex items-center gap-3 flex-wrap justify-center">
        {/* Page-size selector */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground whitespace-nowrap">Per page:</span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onPageSizeChange(Number(v) as PageSize)}
          >
            <SelectTrigger className="w-20 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Page buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1 || isLoading}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {pageNumbers.map((p, i) =>
            p === "…" ? (
              <span key={`ellipsis-${i}`} className="px-1 text-muted-foreground select-none">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "primary" : "outline"}
                size="sm"
                className="h-8 w-8 p-0 text-xs"
                onClick={() => onPageChange(p as number)}
                disabled={isLoading}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </Button>
            )
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages || isLoading || totalPages === 0}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton rows while loading
// ---------------------------------------------------------------------------
function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b animate-pulse">
          {Array.from({ length: 6 }).map((__, j) => (
            <td key={j} className="py-3 px-4">
              <div className="h-4 bg-muted rounded w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page content (inner — uses useSearchParams)
// ---------------------------------------------------------------------------
function LeaderboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [category, setCategory] = useState<LeaderboardCategory>("global");
  const [season, setSeason] = useState(() => searchParams.get("season") ?? "current");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortColumn>("eloRating");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

  const handleSeasonChange = useCallback(
    (newSeason: string) => {
      setSeason(newSeason);
      setPage(1);
      const params = new URLSearchParams(searchParams.toString());
      if (newSeason === "current") {
        params.delete("season");
      } else {
        params.set("season", newSeason);
      }
      const qs = params.toString();
      router.push(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [category, debouncedSearch, sortBy, sortDir, pageSize]);

  const offset = (page - 1) * pageSize;

  // Fetch from the real API via useLeaderboard
  const { data, isLoading, isFetching, isError, refetch } = useLeaderboard(
    category,
    pageSize,
    offset,
    season,
  );

  // Derived values
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rangeStart = totalCount === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + pageSize, totalCount);

  // Client-side search filter (applied on top of server data while the API
  // doesn't yet support a search param — remove once the backend supports it)
  const visibleEntries = useMemo(() => {
    return debouncedSearch
      ? entries.filter((e) =>
          e.username.toLowerCase().includes(debouncedSearch.toLowerCase())
        )
      : entries;
  }, [entries, debouncedSearch]);

  // Sort toggle
  const handleSort = useCallback(
    (col: SortColumn) => {
      if (col === sortBy) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
      } else {
        setSortBy(col);
        setSortDir("desc");
      }
    },
    [sortBy]
  );

  const SortIndicator = ({ col }: { col: SortColumn }) => {
    if (sortBy !== col) return null;
    return sortDir === "desc" ? (
      <ArrowDown className="inline h-3.5 w-3.5 ml-1" aria-hidden="true" />
    ) : (
      <ArrowUp className="inline h-3.5 w-3.5 ml-1" aria-hidden="true" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Trophy className="h-7 w-7 text-yellow-500" aria-hidden="true" />
          Leaderboard
        </h1>
        <p className="text-muted-foreground">
          Top performers across ArenaX — updated in real time.
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div className="space-y-1.5">
              <label htmlFor="search-player" className="text-sm font-medium">
                Search player
              </label>
              <Input
                id="search-player"
                placeholder="Username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <label htmlFor="category-filter" className="text-sm font-medium">
                Category
              </label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as LeaderboardCategory)}
              >
                <SelectTrigger id="category-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Season */}
            <div className="space-y-1.5">
              <label htmlFor="season-filter" className="text-sm font-medium">
                Season
              </label>
              <Select value={season} onValueChange={handleSeasonChange}>
                <SelectTrigger id="season-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEASONS.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sort */}
            <div className="space-y-1.5">
              <label htmlFor="sort-by" className="text-sm font-medium">
                Sort by
              </label>
              <Select
                value={sortBy}
                onValueChange={(v) => handleSort(v as SortColumn)}
              >
                <SelectTrigger id="sort-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_COLUMNS.map((col) => (
                    <SelectItem key={col} value={col}>
                      {SORT_LABELS[col]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rankings table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Rankings
            {isFetching && !isLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading season data…" />
            )}
            {!isLoading && totalCount > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                {totalCount.toLocaleString()} players
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-muted-foreground">Failed to load leaderboard data.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full text-sm" aria-label="Leaderboard rankings">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left py-3 px-4 font-semibold text-muted-foreground uppercase tracking-wider text-xs w-16">
                        Rank
                      </th>
                      <th className="text-left py-3 px-4 font-semibold text-muted-foreground uppercase tracking-wider text-xs">
                        Player
                      </th>
                      <th
                        className="text-right py-3 px-4 font-semibold text-muted-foreground uppercase tracking-wider text-xs cursor-pointer hover:text-foreground transition-colors select-none"
                        onClick={() => handleSort("eloRating")}
                        aria-sort={
                          sortBy === "eloRating"
                            ? sortDir === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        ELO <SortIndicator col="eloRating" />
                      </th>
                      <th
                        className="text-right py-3 px-4 font-semibold text-muted-foreground uppercase tracking-wider text-xs cursor-pointer hover:text-foreground transition-colors select-none"
                        onClick={() => handleSort("wins")}
                        aria-sort={
                          sortBy === "wins"
                            ? sortDir === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        Wins <SortIndicator col="wins" />
                      </th>
                      <th
                        className="text-right py-3 px-4 font-semibold text-muted-foreground uppercase tracking-wider text-xs cursor-pointer hover:text-foreground transition-colors select-none"
                        onClick={() => handleSort("winRate")}
                        aria-sort={
                          sortBy === "winRate"
                            ? sortDir === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        Win Rate <SortIndicator col="winRate" />
                      </th>
                      <th
                        className="text-right py-3 px-4 font-semibold text-muted-foreground uppercase tracking-wider text-xs cursor-pointer hover:text-foreground transition-colors select-none"
                        onClick={() => handleSort("matchesPlayed")}
                        aria-sort={
                          sortBy === "matchesPlayed"
                            ? sortDir === "desc"
                              ? "descending"
                              : "ascending"
                            : "none"
                        }
                      >
                        Matches <SortIndicator col="matchesPlayed" />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isFetching ? (
                      <SkeletonRows count={pageSize} />
                    ) : visibleEntries.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-12 text-center text-muted-foreground"
                        >
                          {debouncedSearch
                            ? `No players found matching "${debouncedSearch}".`
                            : "No players found for this category."}
                        </td>
                      </tr>
                    ) : (
                      visibleEntries.map((player) => {
                        const globalRank = offset + (entries.indexOf(player) + 1);
                        const rankStyle = RANK_STYLES[globalRank];
                        return (
                          <tr
                            key={player.userId}
                            className="border-b hover:bg-muted/40 transition-colors"
                          >
                            {/* Rank */}
                            <td className="py-3 px-4">
                              <Badge
                                variant="outline"
                                className={rankStyle ?? ""}
                              >
                                #{globalRank}
                              </Badge>
                            </td>

                            {/* Player */}
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                {player.avatarUrl ? (
                                  <Image
                                    src={player.avatarUrl}
                                    alt=""
                                    width={28}
                                    height={28}
                                    className="w-7 h-7 rounded-full object-cover shrink-0"
                                    aria-hidden="true"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                                    {player.username[0]?.toUpperCase()}
                                  </div>
                                )}
                                <span className="font-medium truncate max-w-[140px]">
                                  {player.username}
                                </span>
                              </div>
                            </td>

                            {/* ELO */}
                            <td className="py-3 px-4 text-right font-semibold tabular-nums">
                              {player.eloRating.toLocaleString()}
                            </td>

                            {/* Wins */}
                            <td className="py-3 px-4 text-right tabular-nums">
                              {player.wins.toLocaleString()}
                            </td>

                            {/* Win Rate */}
                            <td className="py-3 px-4 text-right tabular-nums">
                              <span
                                className={
                                  player.winRate >= 0.6
                                    ? "text-green-600 dark:text-green-400 font-semibold"
                                    : player.winRate < 0.4
                                    ? "text-red-600 dark:text-red-400"
                                    : ""
                                }
                              >
                                {(player.winRate * 100).toFixed(1)}%
                              </span>
                            </td>

                            {/* Matches */}
                            <td className="py-3 px-4 text-right tabular-nums text-muted-foreground">
                              {player.matchesPlayed.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {!isFetching && totalCount > 0 && (
                <Pagination
                  page={page}
                  totalPages={totalPages}
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  totalCount={totalCount}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => {
                    setPageSize(s);
                    setPage(1);
                  }}
                  isLoading={isFetching}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export — wraps content in Suspense for useSearchParams
// ---------------------------------------------------------------------------
export default function LeaderboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LeaderboardContent />
    </Suspense>
  );
}
