/**
 * Match request validation schemas.
 */

import { z } from "zod";
import { Field } from "../fields";
import { Validators } from "../validators";
import { defineSchema } from "../schema";

// ─── Report score ─────────────────────────────────────────────────────────────

export const reportScoreSchema = defineSchema(
  "reportScore",
  {
    score: Validators.matchScore(),
    opponentScore: Validators.matchScore(),
    proofUrl: Validators.proofUrl(),
    telemetryData: z.record(z.string(), z.unknown()).optional(),
  },
  { description: "Match score report", tags: ["match"] },
);

export type ReportScoreRequest = z.infer<typeof reportScoreSchema.schema>;

// ─── Match filters ────────────────────────────────────────────────────────────

export const matchFiltersSchema = defineSchema(
  "matchFilters",
  {
    tournamentId: Validators.uuid({ optional: true }),
    playerId: Validators.uuid({ optional: true }),
    userId: Validators.uuid({ optional: true }),
    status: z
      .enum(["pending", "in_progress", "completed", "disputed", "cancelled"])
      .optional(),
    gameType: z.string().optional(),
    mine: z.boolean().optional(),
    page: Validators.page(),
    limit: Validators.limit({ max: 100 }),
  },
  { description: "Match list filter parameters", tags: ["match"] },
);

export type MatchFilters = z.infer<typeof matchFiltersSchema.schema>;

// ─── Ready up (lobby) ─────────────────────────────────────────────────────────

export const readyUpSchema = defineSchema(
  "readyUp",
  {
    sessionId: Field.text({ requiredMessage: "Session ID is required" }),
  },
  { description: "Player ready-up in match lobby", tags: ["match"] },
);

export type ReadyUpRequest = z.infer<typeof readyUpSchema.schema>;
