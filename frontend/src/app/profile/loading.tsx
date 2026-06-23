import { Skeleton, CardSkeleton } from "@/components/common/PageSkeleton";

export default function ProfileLoading() {
  return (
    <div className="py-4 space-y-8">
      {/* Profile header card */}
      <div className="flex flex-col md:flex-row gap-8 items-start md:items-center bg-card border rounded-xl p-8 shadow-sm">
        <Skeleton className="h-32 w-32 rounded-full shrink-0" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-4 w-64" />
          <div className="flex gap-4 mt-4">
            <Skeleton className="h-14 w-24 rounded-lg" />
            <Skeleton className="h-14 w-24 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-28 rounded-md mt-2" />
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* ELO chart */}
          <div className="rounded-lg border bg-card shadow-sm p-6 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-48 w-full rounded-md" />
          </div>
          {/* Bio */}
          <CardSkeleton lines={4} />
        </div>
        {/* Match history */}
        <div className="space-y-8">
          <CardSkeleton lines={6} />
        </div>
      </div>
    </div>
  );
}
