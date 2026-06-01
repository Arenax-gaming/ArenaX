import { TournamentCardSkeleton } from "@/components/tournaments/TournamentCardSkeleton";
import { PageHeaderSkeleton, Skeleton } from "@/components/common/PageSkeleton";

export default function TournamentsLoading() {
  return (
    <div className="min-h-screen px-4 py-8 bg-background space-y-8">
      <PageHeaderSkeleton />
      {/* Tab strip */}
      <div className="flex justify-center">
        <Skeleton className="h-10 w-64 rounded-lg" />
      </div>
      {/* Filter bar */}
      <Skeleton className="h-24 w-full rounded-lg" />
      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <TournamentCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
