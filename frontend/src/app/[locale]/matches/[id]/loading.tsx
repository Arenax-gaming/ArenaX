import { Skeleton } from "@/components/common/PageSkeleton";

export default function MatchHubLoading() {
  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Back button */}
        <Skeleton className="h-8 w-16 rounded-md" />

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
          {/* Left — match hero + feed */}
          <div className="space-y-6">
            {/* Hero card */}
            <div className="rounded-[32px] border bg-muted/30 p-6 space-y-6">
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
              {/* VS row */}
              <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr]">
                <div className="rounded-[28px] border p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-14 w-14 rounded-2xl" />
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 rounded-2xl" />
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-center">
                  <Skeleton className="h-10 w-16 rounded-full" />
                </div>
                <div className="rounded-[28px] border p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-14 w-14 rounded-2xl" />
                    <div className="space-y-2">
                      <Skeleton className="h-5 w-28" />
                      <Skeleton className="h-3 w-20" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 rounded-2xl" />
                    ))}
                  </div>
                </div>
              </div>
              {/* Stats row */}
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-2xl" />
                ))}
              </div>
            </div>

            {/* Feed + context */}
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[32px] border bg-card p-6 space-y-4">
                <Skeleton className="h-4 w-40" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 rounded-2xl" />
                ))}
              </div>
              <div className="rounded-[32px] border bg-card p-6 space-y-4">
                <Skeleton className="h-4 w-32" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-md" />
                ))}
              </div>
            </div>
          </div>

          {/* Right — score reporting */}
          <div className="space-y-6">
            <div className="rounded-[32px] border bg-card p-6 space-y-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-16 rounded-2xl" />
              <div className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-16 rounded-md" />
                <Skeleton className="h-16 rounded-md" />
              </div>
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
            <div className="rounded-[32px] border bg-card p-6 space-y-4">
              <Skeleton className="h-4 w-36" />
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-2xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
