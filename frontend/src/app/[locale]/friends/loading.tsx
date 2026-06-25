import { PageHeaderSkeleton, Skeleton, UserRowSkeleton } from "@/components/common/PageSkeleton";

export default function FriendsLoading() {
  return (
    <div className="min-h-screen px-4 py-8 space-y-8">
      {/* Page header */}
      <PageHeaderSkeleton />

      {/* Tab bar */}
      <div className="flex gap-4 border-b border-border pb-px">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-t-md" />
        ))}
      </div>

      {/* Search input */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Friends list card */}
      <div className="bg-card rounded-lg border p-6">
        <UserRowSkeleton count={8} />
      </div>
    </div>
  );
}
