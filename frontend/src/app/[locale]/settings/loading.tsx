import { SettingsPageSkeleton } from "@/components/common/PageSkeleton";

/**
 * Shared loading skeleton for all /settings/* routes.
 * Renders the two-column layout (sidebar nav + form) so the transition
 * from skeleton → content is as smooth as possible.
 */
export default function SettingsLoading() {
  return <SettingsPageSkeleton />;
}
