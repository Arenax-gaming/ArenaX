"use client";

import React, { useEffect, useState, useCallback, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { ProtectedPage } from "@/components/navigation/ProtectedPage";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const PAGE_SIZE = 20;

interface AuditLog {
  id: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: string;
  createdAt: string;
}

interface AuditLogsResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

function useDebounce<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function AuditLogPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read initial filter state from URL
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [startDate, setStartDate] = useState(searchParams.get("startDate") ?? "");
  const [endDate, setEndDate] = useState(searchParams.get("endDate") ?? "");
  const [page, setPage] = useState(Number(searchParams.get("page") ?? 1));

  const debouncedSearch = useDebounce(search);

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Sync URL when filters/page change
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    startTransition(() => {
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    });
  }, [debouncedSearch, startDate, endDate, page, pathname, router]);

  const fetchLogs = useCallback(async () => {
    // Validate date range
    if (startDate && endDate && startDate > endDate) {
      setError("Start date must be before end date.");
      setLogs([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        page: String(page),
        pageSize: String(PAGE_SIZE),
      };
      if (debouncedSearch) params.search = debouncedSearch;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const data = (await api.getAuditLogs(params)) as AuditLogsResponse | AuditLog[];

      if (Array.isArray(data)) {
        setLogs(data);
        setTotal(data.length);
      } else {
        setLogs(data.logs ?? []);
        setTotal(data.total ?? 0);
      }
    } catch (err) {
      setError((err as Error).message ?? "Failed to load audit logs.");
      setLogs([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, startDate, endDate, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, startDate, endDate]);

  const clearFilters = () => {
    setSearch("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const hasFilters = search || startDate || endDate;

  return (
    <ProtectedPage requiredRole="admin">
      <div className="container mx-auto p-6 space-y-6">
        <header>
          <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
            Audit Log
          </h1>
          <p className="text-xl text-muted-foreground mt-1">
            Track all admin actions across the platform.
          </p>
        </header>

        {/* Filter controls */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end flex-wrap">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label htmlFor="search" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Search
            </label>
            <Input
              id="search"
              placeholder="Actor, action, or resource type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search audit logs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="startDate" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              From
            </label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              max={endDate || undefined}
              aria-label="Start date"
              className="w-40"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="endDate" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              To
            </label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate || undefined}
              aria-label="End date"
              className="w-40"
            />
          </div>

          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="self-end h-10">
              Clear filters
            </Button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted/40 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <Card className="bg-muted/50 border-dashed border-2">
            <CardContent className="flex items-center justify-center h-40 text-muted-foreground">
              {hasFilters
                ? "No logs match the current filters."
                : "No audit logs found."}
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  {["Timestamp", "Actor", "Action", "Resource Type", "Resource ID", "Details"].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 font-semibold text-muted-foreground uppercase tracking-wider text-xs whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium truncate max-w-[120px]">{log.actor}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{log.resourceType}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs truncate max-w-[100px]">
                      {log.resourceId ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">
                      {log.details ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between gap-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
              {total > 0 && ` · ${total} total entries`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                ← Prev
              </Button>
              {/* Page number buttons — show up to 5 around current */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                return start + i;
              }).map((p) => (
                <Button
                  key={p}
                  variant={p === page ? "primary" : "outline"}
                  size="sm"
                  onClick={() => setPage(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? "page" : undefined}
                >
                  {p}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label="Next page"
              >
                Next →
              </Button>
            </div>
          </div>
        )}
      </div>
    </ProtectedPage>
  );
}
