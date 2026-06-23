import {
  Skeleton,
  AvatarSkeleton,
  CardSkeleton,
  StatRowSkeleton,
} from "@/components/common/PageSkeleton";

export default function PublicProfileLoading() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl space-y-6">
      {/* Profile header card */}
      <div className="flex flex-col md:flex-row gap-6 items-start md:items-center bg-card border rounded-xl p-8 shadow-sm">
        <AvatarSkeleton size="xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-64" />
          <div className="flex gap-4 mt-4">
            <Skeleton className="h-14 w-24 rounded-lg" />
            <Skeleton className="h-14 w-24 rounded-lg" />
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-32 rounded-md" />
        <Skeleton className="h-9 w-36 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md ml-auto" />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: stats + history + achievements */}
        <div className="lg:col-span-2 space-y-6">
          {/* Stats + ELO chart */}
          <div className="rounded-lg border bg-card shadow-sm p-6 space-y-4">
            <Skeleton className="h-5 w-32" />
            <StatRowSkeleton count={4} />
            <Skeleton className="h-48 w-full rounded-md" />
          </div>
          {/* Match history */}
          <CardSkeleton lines={5} />
          {/* Achievements */}
          <CardSkeleton lines={4} />
        </div>

        {/* Right: friends + activity */}
        <div className="space-y-6">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}
