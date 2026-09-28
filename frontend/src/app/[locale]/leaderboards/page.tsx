import { redirect } from "next/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * `/leaderboards` was a near-duplicate of the canonical `/leaderboard`
 * route (README §API reference calls out `GET /leaderboard`) — same
 * content, different URL, which split analytics and confused SEO (#1085).
 * Kept as a permanent redirect (rather than deleted) so old bookmarks and
 * external links to `/leaderboards` still land somewhere.
 */
export default function LeaderboardsRedirectPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: Locale };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) query.set(key, value[0]);
  }
  const qs = query.toString();

  redirect(`/${locale}/leaderboard${qs ? `?${qs}` : ""}`);
}
