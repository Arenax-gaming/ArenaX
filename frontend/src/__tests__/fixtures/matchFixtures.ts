/**
 * Test-only fixture re-exports for match data.
 *
 * Import from here in tests — never import matchHubDetails or mockMatchDetails
 * directly from src/data/* in production pages or hooks.
 */

export { matchHubDetails } from "@/data/matchHub";
export { mockMatchDetails, mockMatchHistory } from "@/data/matches";
