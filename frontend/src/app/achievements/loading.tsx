import { PageHeaderSkeleton, AchievementCardSkeleton, Skeleton } from "@/components/common/PageSkeleton";

export default function AchievementsLoading() {
  return (
    <div className="min-h-screen px-4 py-8 space-y-8">
      {/* Header row with progress link */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <PageHeaderSkeleton />
          {/* "N of M unlocked · X points" sub-line */}
          <Skeleton className="h-4 w-48" />
        </div>
        {/* View Progress button */}
        <Skeleton className="h-9 w-36 rounded-md self-start" />
      </div>

      {/* Achievement grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <AchievementCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
