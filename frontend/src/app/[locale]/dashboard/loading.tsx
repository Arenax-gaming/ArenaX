import {
  Skeleton,
  StatRowSkeleton,
  CardSkeleton,
} from "@/components/common/PageSkeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-full shrink-0" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>

      {/* Stats row */}
      <StatRowSkeleton count={4} />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          <CardSkeleton lines={5} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <CardSkeleton lines={4} />
            <CardSkeleton lines={4} />
          </div>
        </div>
        {/* Right sidebar */}
        <div className="space-y-6">
          <CardSkeleton lines={3} hasFooter />
          <CardSkeleton lines={4} />
          <CardSkeleton lines={3} />
        </div>
      </div>
    </div>
  );
}
