"use client";

/**
 * DynamicPage — code-split page wrapper with error boundary and retry.
 *
 * Wraps lazily-loaded client components so that:
 *   - The heavy component is only loaded when the route is visited
 *   - Chunk load failures are caught and tracked
 *   - A consistent fallback skeleton is shown during loading
 *   - The user can retry on failure without a full page reload
 *
 * Usage:
 *   import dynamic from "next/dynamic";
 *
 *   const HeavyChart = dynamic(() => import("@/components/analytics/HeavyChart"), {
 *     loading: () => <PageSkeleton />,
 *     ssr: false,
 *   });
 *
 * Or use this component directly when you want the full guard + split combo:
 *
 *   <DynamicPage
 *     loader={() => import("@/components/wallet/WalletDashboard").then(m => m.WalletDashboard)}
 *     requirement="verified"
 *   />
 */

import {
  lazy,
  Suspense,
  useState,
  useCallback,
  ComponentType,
  ReactNode,
} from "react";
import { RouteGuard, RouteGuardProps } from "./RouteGuard";
import { trackChunkLoadFailure } from "@/lib/routeAnalytics";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function PageLoadingSkeleton() {
  return (
    <div className="w-full space-y-4 p-6 animate-pulse" role="status" aria-label="Loading content">
      <div className="h-8 w-1/3 bg-muted rounded-lg" />
      <div className="h-4 w-2/3 bg-muted rounded" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 bg-muted rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chunk error boundary (class component — required by React)
// ---------------------------------------------------------------------------

interface ChunkErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

interface ChunkErrorBoundaryProps {
  children: ReactNode;
  onRetry: () => void;
  chunkName?: string;
  currentPath?: string;
}

class ChunkErrorBoundary extends React.Component<
  ChunkErrorBoundaryProps,
  ChunkErrorBoundaryState
> {
  constructor(props: ChunkErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): ChunkErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  componentDidCatch(error: Error) {
    trackChunkLoadFailure({
      chunkName: this.props.chunkName ?? "unknown",
      path: this.props.currentPath ?? (typeof window !== "undefined" ? window.location.pathname : ""),
      error: error.message,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center px-4">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-foreground">Failed to load this page</p>
            <p className="text-sm text-muted-foreground mt-1">
              A component bundle could not be downloaded. Check your connection and try again.
            </p>
          </div>
          <button
            onClick={this.props.onRetry}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// React import required for the class component above
import React from "react";

// ---------------------------------------------------------------------------
// DynamicPage component
// ---------------------------------------------------------------------------

export interface DynamicPageProps<P extends object = object>
  extends Omit<RouteGuardProps, "children"> {
  /**
   * A function that returns a promise resolving to the component constructor.
   * Same signature as the first argument of `React.lazy`.
   */
  loader: () => Promise<ComponentType<P>>;
  /** Props to pass through to the loaded component. */
  componentProps?: P;
  /** Optional name used in chunk error tracking. */
  chunkName?: string;
  /** Custom loading UI while the chunk downloads. */
  skeleton?: ReactNode;
}

export function DynamicPage<P extends object = object>({
  loader,
  componentProps,
  chunkName,
  skeleton,
  requirement,
  loginRedirect,
  loadingFallback,
}: DynamicPageProps<P>) {
  const [key, setKey] = useState(0);

  const handleRetry = useCallback(() => {
    setKey((k) => k + 1);
  }, []);

  // Re-create the lazy component on retry so React attempts the import again
  const LazyComponent = lazy(loader) as ComponentType<P>;

  const currentPath =
    typeof window !== "undefined" ? window.location.pathname : "";

  return (
    <RouteGuard
      requirement={requirement}
      loginRedirect={loginRedirect}
      loadingFallback={loadingFallback}
    >
      <ChunkErrorBoundary
        key={key}
        onRetry={handleRetry}
        chunkName={chunkName}
        currentPath={currentPath}
      >
        <Suspense fallback={skeleton ?? <PageLoadingSkeleton />}>
          <LazyComponent {...(componentProps as P)} />
        </Suspense>
      </ChunkErrorBoundary>
    </RouteGuard>
  );
}
