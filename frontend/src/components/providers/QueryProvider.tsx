"use client";

import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from "@tanstack/react-query";
import { useState } from "react";
import { logError } from "@/lib/errorLogger";
import { ArenaXError, ErrorCategory, ErrorSeverity } from "@/lib/errors";
import { datadogRum } from "@datadog/browser-rum";

// ─── Query error handler ──────────────────────────────────────────────────────

/**
 * Translates a TanStack Query error into an `ArenaXError` so it flows through
 * the structured logging / analytics pipeline, and forwards it to Datadog RUM.
 */
function handleQueryError(error: unknown, context?: Record<string, unknown>): void {
  const err =
    error instanceof Error
      ? error
      : new ArenaXError(
          String(error ?? "Unknown query error"),
          ErrorCategory.API,
          ErrorSeverity.MEDIUM,
        );

  logError(err, { source: "QueryClient", ...context });

  // Forward to Datadog RUM. Context only contains query/mutation keys —
  // no tokens, passwords, or user PII.
  datadogRum.addError(err, {
    source: "QueryClient",
    ...context,
  });
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 20_000,
          },
        },
        queryCache: new QueryCache({
          onError: (error, query) =>
            handleQueryError(error, {
              queryKey: JSON.stringify(query.queryKey),
            }),
        }),
        mutationCache: new MutationCache({
          onError: (error, _variables, _context, mutation) =>
            handleQueryError(error, {
              mutationKey: mutation.options.mutationKey
                ? JSON.stringify(mutation.options.mutationKey)
                : undefined,
            }),
        }),
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
