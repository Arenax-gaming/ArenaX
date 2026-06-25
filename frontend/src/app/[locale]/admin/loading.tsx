import {
  PageHeaderSkeleton,
  ListItemSkeleton,
  TableSkeleton,
  Skeleton,
} from "@/components/common/PageSkeleton";

/**
 * Shared loading skeleton for all /admin/* routes.
 * Each sub-page has its own inline skeleton too, but this catches
 * the initial navigation before the page component mounts.
 */
export default function AdminLoading() {
  return (
    <div className="container mx-auto p-6 space-y-8">
      <PageHeaderSkeleton />
      {/* Generic content area — shows a table skeleton as a neutral placeholder */}
      <TableSkeleton rows={8} cols={5} />
      {/* Card list below */}
      <div className="grid gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <ListItemSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
