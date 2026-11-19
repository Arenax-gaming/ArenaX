import type { Metadata } from "next";
import { MatchInvitePageClient } from "./MatchInvitePageClient";

export function generateMetadata(): Metadata {
  return {
    title: "Match Invite — ArenaX",
    description: "Review and respond to a match invite on ArenaX.",
  };
}

/**
 * Issue #1562 — `/match/invite/:token` deep-link landing page.
 *
 * Unauthenticated visitors are redirected to `/login?returnTo=...` by the
 * Edge middleware (src/middleware.ts) and sent straight back here once
 * signed in. The client component below resolves the token and renders the
 * invite card (or a clear error for an expired/invalid token).
 */
export default function MatchInvitePage() {
  return <MatchInvitePageClient />;
}
