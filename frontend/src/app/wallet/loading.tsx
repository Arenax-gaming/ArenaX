import { Skeleton, StatRowSkeleton, CardSkeleton } from "@/components/common/PageSkeleton";

export default function WalletLoading() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-56" />
      </div>

      {/* Balance cards */}
      <StatRowSkeleton count={3} />

      {/* Connect card + action buttons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <CardSkeleton lines={3} hasFooter />
        <CardSkeleton lines={3} hasFooter />
      </div>

      {/* Transaction history */}
      <div className="rounded-lg border bg-card shadow-sm p-6 space-y-4">
        <Skeleton className="h-5 w-40" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-5 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
