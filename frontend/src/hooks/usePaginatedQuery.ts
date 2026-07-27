"use client";

/**
 * usePaginatedQuery — data fetching hook with page/offset pagination,
 * prefetching, and TanStack Query integration.
 *
 * Builds on top of TanStack Query's useQuery to provide:
 *  - Page state managed inside the hook
 *  - Automatic prefetch of next page in background
 *  - Derived helper flags: isFirstPage, isLastPage, hasNextPage, hasPrevPage
 *  - Go-to-page, next, previous, and reset navigation
 *  - Configurable page size
 *
 * @example
 * const {
 *   data, page, totalPages, goToNext, goToPrev, goToPage
 * } = usePaginatedQuery({
 *   queryKey: ["tournaments"],
 *   queryFn: (page, pageSize) => api.getTournaments({ page, limit: pageSize }),
 *   pageSize: 20,
 * });
 */

import { useState, useCallback, useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
  type QueryFunction,
} from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface UsePaginatedQueryOptions<T> {
  /** Base query key — page number is appended automatically. */
  queryKey: QueryKey;
  /**
   * Fetch function. Receives the current page (1-based) and the page size.
   * Must return a PaginatedResponse or a plain array (treated as one page).
   */
  queryFn: (
    page: number,
    pageSize: number
  ) => Promise<PaginatedResponse<T> | T[]>;
  /** Items per page (default 20). */
  pageSize?: number;
  /** Start on this page (default 1). */
  initialPage?: number;
  /** Whether to prefetch the next page in the background (default true). */
  prefetchNext?: boolean;
  /** Extra TanStack Query options forwarded to useQuery. */
  queryOptions?: Omit<
    UseQueryOptions<PaginatedResponse<T>>,
    "queryKey" | "queryFn"
  >;
}

export interface UsePaginatedQueryResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  isFirstPage: boolean;
  isLastPage: boolean;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  goToNext: () => void;
  goToPrev: () => void;
  goToPage: (page: number) => void;
  reset: () => void;
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Normalise fetch result to PaginatedResponse
// ---------------------------------------------------------------------------

function normalise<T>(
  result: PaginatedResponse<T> | T[],
  page: number,
  pageSize: number
): PaginatedResponse<T> {
  if (Array.isArray(result)) {
    return {
      data: result,
      total: result.length,
      page,
      pageSize,
      totalPages: 1,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePaginatedQuery<T>({
  queryKey,
  queryFn,
  pageSize = 20,
  initialPage = 1,
  prefetchNext = true,
  queryOptions = {},
}: UsePaginatedQueryOptions<T>): UsePaginatedQueryResult<T> {
  const [page, setPage] = useState(initialPage);
  const queryClient = useQueryClient();

  const fullQueryKey = [...(Array.isArray(queryKey) ? queryKey : [queryKey]), page, pageSize];

  const query = useQuery<PaginatedResponse<T>>({
    ...queryOptions,
    queryKey: fullQueryKey,
    queryFn: async () => {
      const result = await queryFn(page, pageSize);
      return normalise(result, page, pageSize);
    },
    placeholderData: (prev) => prev, // keep previous page visible while fetching
    staleTime: queryOptions.staleTime ?? 30_000,
  });

  const totalPages = query.data?.totalPages ?? 1;

  // Prefetch next page in the background
  useEffect(() => {
    if (!prefetchNext || !query.data || page >= totalPages) return;

    const nextKey = [
      ...(Array.isArray(queryKey) ? queryKey : [queryKey]),
      page + 1,
      pageSize,
    ];

    queryClient.prefetchQuery({
      queryKey: nextKey,
      queryFn: async () => {
        const result = await queryFn(page + 1, pageSize);
        return normalise(result, page + 1, pageSize);
      },
      staleTime: queryOptions.staleTime ?? 30_000,
    });
  }, [
    page,
    totalPages,
    prefetchNext,
    queryClient,
    queryKey,
    pageSize,
    queryFn,
    query.data,
    queryOptions.staleTime,
  ]);

  const goToNext = useCallback(() => {
    setPage((p) => Math.min(p + 1, totalPages));
  }, [totalPages]);

  const goToPrev = useCallback(() => {
    setPage((p) => Math.max(p - 1, 1));
  }, []);

  const goToPage = useCallback(
    (target: number) => {
      setPage(Math.max(1, Math.min(target, totalPages)));
    },
    [totalPages]
  );

  const reset = useCallback(() => {
    setPage(initialPage);
  }, [initialPage]);

  const isFirstPage = page === 1;
  const isLastPage = page >= totalPages;

  return {
    data: query.data?.data ?? [],
    total: query.data?.total ?? 0,
    page,
    pageSize,
    totalPages,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error as Error | null,
    isFirstPage,
    isLastPage,
    hasNextPage: !isLastPage,
    hasPrevPage: !isFirstPage,
    goToNext,
    goToPrev,
    goToPage,
    reset,
    refetch: query.refetch,
  };
}
