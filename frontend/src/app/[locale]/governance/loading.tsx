import {
  PageHeaderSkeleton,
  ListItemSkeleton,
  Skeleton,
} from "@/components/common/PageSkeleton";

export default function GovernanceLoading() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <PageHeaderSkeleton />

      {/* Auth notice placeholder */}
      <Skeleton className="h-12 w-full rounded-lg" />

      {/* Tabs placeholder */}
      <Skeleton className="h-11 w-72 rounded-lg" />

      {/* Proposal card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <ListItemSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
