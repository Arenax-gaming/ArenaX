import {
  PageHeaderSkeleton,
  NotificationRowSkeleton,
  Skeleton,
} from "@/components/common/PageSkeleton";

export default function NotificationsLoading() {
  return (
    <div className="min-h-screen px-4 py-8 space-y-8">
      {/* Header + actions row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeaderSkeleton />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-28 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>

      {/* Notification list card */}
      <div className="bg-card rounded-lg border shadow-sm">
        <NotificationRowSkeleton count={8} />
      </div>
    </div>
  );
}
