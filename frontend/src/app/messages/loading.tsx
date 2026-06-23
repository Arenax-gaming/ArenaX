import { PageHeaderSkeleton, MessagesPanelSkeleton } from "@/components/common/PageSkeleton";

export default function MessagesLoading() {
  return (
    <div className="min-h-screen px-4 py-8 space-y-8">
      <PageHeaderSkeleton />
      <MessagesPanelSkeleton />
    </div>
  );
}
