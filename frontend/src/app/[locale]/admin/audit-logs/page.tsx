"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { TableSkeleton } from "@/components/common/PageSkeleton";
import { PageError } from "@/components/common/PageError";
import { EmptyState } from "@/components/common/EmptyState";
import { useDebounce } from "@/hooks/useSearch";
import { formatDate } from "@/lib/utils";
import { FileText, Search, ChevronLeft, ChevronRight, X } from "lucide-react";

const PAGE_SIZE = 20;

interface AuditLog {
  id: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  createdAt: string;
}

function buildURLString(q: string, sd: string, ed: string, p: number): string {
  const params = new URLSearchParams();
  if (q) params.set("search", q);
  if (sd) params.set("startDate", sd);
  if (ed) params.set("endDate", ed);
  if (p > 1) params.set("page", String(p));
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

export default function AuditLogsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [startDate, setStartDate] = useState(searchParams.get("startDate") ?? "");
  const [endDate, setEndDate] = useState(searchParams.get("endDate") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1"));

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  // Tracks in-flight requests so stale responses are silently dropped.
  const requestIdRef = useRef(0);
  // Skips the URL push on initial mount (URL already reflects the correct state).
  const hasMountedRef = useRef(false);
  // Skips the debouncedSearch effect on the very first render.
  const debouncedMountedRef = useRef(false);

  const applyFilters = useCallback(
    (q: string, sd: string, ed: string, p: number, updateURL: boolean) => {
      const requestId = ++requestIdRef.current;

      if (updateURL) {
        router.push(buildURLString(q, sd, ed, p), { scroll: false });
      }

      setLoading(true);
      setError(null);

      const apiParams: Record<string, string> = {
        page: String(p),
        pageSize: String(PAGE_SIZE),
      };
      if (q) apiParams.search = q;
      if (sd) apiParams.startDate = sd;
      if (ed) apiParams.endDate = ed;

      (api.getAuditLogs(apiParams) as Promise<any>)
        .then((data) => {
          if (requestIdRef.current !== requestId) return;
          setLogs(data.logs ?? []);
          setTotal(data.total ?? 0);
          setLoading(false);
        })
        .catch((err: Error) => {
          if (requestIdRef.current !== requestId) return;
          setError(err.message ?? "Failed to load audit logs.");
          setLogs([]);
          setLoading(false);
        });
    },
    [router]
  );

  // Initial fetch — reads params already reflected in state from the URL.
  useEffect(() => {
    hasMountedRef.current = true;
    applyFilters(search, startDate, endDate, page, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when debounced search settles, resetting to page 1.
  useEffect(() => {
    if (!debouncedMountedRef.current) {
      debouncedMountedRef.current = true;
      return;
    }
    setPage(1);
    applyFilters(debouncedSearch, startDate, endDate, 1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    setPage(1);
    applyFilters(debouncedSearch, value, endDate, 1, true);
  };

  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    setPage(1);
    applyFilters(debouncedSearch, startDate, value, 1, true);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    applyFilters(debouncedSearch, startDate, endDate, newPage, true);
  };

  const handleClearFilters = () => {
    setSearch("");
    setStartDate("");
    setEndDate("");
    setPage(1);
    applyFilters("", "", "", 1, true);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasActiveFilters = Boolean(debouncedSearch || startDate || endDate);

  return (
    <ProtectedPage requiredRole="admin">
      <div className="container mx-auto p-6 space-y-6">
        <header>
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
            Audit Logs
          </h1>
          <p className="text-xl text-muted-foreground">
            Browse and filter the complete record of administrative actions.
          </p>
        </header>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              placeholder="Search by actor, action, or resource type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex gap-2 flex-wrap items-end">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="start-date"
                className="text-xs font-medium text-muted-foreground"
              >
                Start date
              </label>
              <input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => handleStartDateChange(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="end-date"
                className="text-xs font-medium text-muted-foreground"
              >
                End date
              </label>
              <input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => handleEndDateChange(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="gap-1.5 h-10 self-end"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <TableSkeleton rows={8} cols={5} />
        ) : error ? (
          <PageError
            title="Failed to load audit logs"
            message={error}
            onRetry={() =>
              applyFilters(debouncedSearch, startDate, endDate, page, false)
            }
          />
        ) : logs.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No audit logs found"
            description={
              hasActiveFilters
                ? "Try adjusting your filters."
                : "No activity has been recorded yet."
            }
          />
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Timestamp
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Actor
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Action
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Resource type
                    </th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">
                      Resource ID
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {formatDate(log.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-medium max-w-[180px] truncate">
                        {log.actor}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {log.resourceType}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {log.resourceId ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Showing{" "}
                {Math.min((page - 1) * PAGE_SIZE + 1, total)}–
                {Math.min(page * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </Button>
                <span className="px-1 tabular-nums">
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages}
                  aria-label="Next page"
                >
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
