import { BracketPlayer } from "@/types/bracket";
import { Tournament } from "@/types/tournament";

const NAME_POOL = [
  "ProGamer99", "ShadowNinja", "EliteSniper", "DragonSlayer", "NightWalker",
  "SpeedRunner", "CyberPunk", "IronWolf", "NovaQueen", "BlitzForge",
  "PhantomAce", "SolarFlare", "VortexKing", "SteelHawk", "CrimsonFang", "ZenithRider",
];

/**
 * Deterministic mock roster for a tournament that hasn't generated a bracket
 * yet (registration is still open) — used by `BracketSeedingEditor` (#1092)
 * so admins can arrange seeds before the bracket locks in. Consistent with
 * the rest of this frontend's tournament pages, which run entirely on mock
 * data (`mockTournaments`, `generateMockBracket`) rather than a live backend.
 */
export function generateMockRoster(tournament: Tournament): BracketPlayer[] {
  const count = Math.max(2, Math.min(tournament.currentParticipants || NAME_POOL.length, NAME_POOL.length));
  return Array.from({ length: count }, (_, i) => ({
    id: `${tournament.id}-player-${i + 1}`,
    username: NAME_POOL[i % NAME_POOL.length],
    elo: 2000 - i * 35,
    seed: i + 1,
  }));
}
