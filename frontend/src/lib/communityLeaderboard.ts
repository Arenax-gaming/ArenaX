/**
 * Community leaderboard (Issue #1257).
 *
 * Rankings come from `GET /api/community/leaderboard`. The reputation column
 * is the Stellar Reputation Token balance. Live updates arrive on
 * `community:{id}` and are applied only when they match the active filter and
 * are not older than the board already on screen.
 */

export interface RankedPlayer {
  rank: number;
  user_id: string;
  username: string;
  reputation: string;
  reputation_stroops: number;
}

export interface CommunityBoard {
  community_id: string;
  tournament_id: string | null;
  version: number;
  entries: RankedPlayer[];
}

export function communityChannel(communityId: string): string {
  return `community:${communityId.trim().toLowerCase()}`;
}

export function mergeBoard(
  current: CommunityBoard | null,
  incoming: CommunityBoard,
  expectedCommunity: string,
  expectedTournament: string | null,
): CommunityBoard | null {
  if (incoming.community_id !== expectedCommunity) return current;
  if ((incoming.tournament_id ?? null) !== expectedTournament) return current;
  const currentMatches =
    current !== null &&
    current.community_id === expectedCommunity &&
    (current.tournament_id ?? null) === expectedTournament;
  if (currentMatches && incoming.version < current.version) return current;
  return incoming;
}

export function boardFromSocket(
  raw: string,
  expectedCommunity: string,
  expectedTournament: string | null,
): CommunityBoard | null {
  try {
    const payload = JSON.parse(raw) as { event?: { type?: string } & CommunityBoard };
    const event = payload.event;
    if (!event || event.type !== "community_leaderboard") return null;
    if (!Array.isArray(event.entries)) return null;
    return mergeBoard(null, event, expectedCommunity, expectedTournament);
  } catch {
    return null;
  }
}

export async function fetchBoard(community: string, tournament: string): Promise<CommunityBoard> {
  const params = new URLSearchParams({ community: community.trim().toLowerCase() });
  const filter = tournament.trim().toLowerCase();
  if (filter) params.set("tournament", filter);
  const response = await fetch(`/api/community/leaderboard?${params.toString()}`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Couldn't load the community leaderboard");
  }
  return (await response.json()) as CommunityBoard;
}

export function leaderboardWsUrl(): string {
  if (typeof window === "undefined") return "";
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}
