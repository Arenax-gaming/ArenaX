import {
  PageHeaderSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/common/PageSkeleton";

export default function LeaderboardLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      {/* Filter card */}
      <Skeleton className="h-28 w-full rounded-lg" />
      {/* Rankings card */}
      <div className="rounded-lg border bg-card shadow-sm p-6 space-y-4">
        <Skeleton className="h-5 w-32" />
        <TableSkeleton rows={25} cols={6} />
        {/* Pagination row */}
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-4 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-8 rounded-md" />
            ))}
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
