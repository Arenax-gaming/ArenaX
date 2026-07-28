/**
 * Tournament request validation schemas.
 */

import { z } from "zod";
import { Field } from "../fields";
import { Validators } from "../validators";
import { defineSchema } from "../schema";

// ─── Create tournament ────────────────────────────────────────────────────────

export const createTournamentSchema = defineSchema(
  "createTournament",
  {
    name: Field.text({
      min: 3,
      max: 100,
      requiredMessage: "Tournament name is required",
      minMessage: "Tournament name must be at least 3 characters",
    }),
    description: Field.optionalText({ max: 2000 }),
    gameType: z.string().min(1, "Game type is required"),
    tournamentType: Field.enum(
      ["single_elimination", "double_elimination", "round_robin", "swiss"] as const,
      { message: "Select a valid tournament format" },
    ),
    entryFee: Validators.entryFee(),
    prizePool: Validators.prizePool(),
    maxParticipants: Validators.maxParticipants({ allowAny: true, min: 2, max: 1024 }),
    visibility: Field.enum(["public", "private", "invite_only"] as const, {
      message: "Select a valid visibility option",
    }),
    startTime: Field.isoDate({ futureOnly: true, futureMessage: "Start time must be in the future" }),
    registrationOpenDate: Field.isoDate({ optional: true }),
    registrationCloseDate: Field.isoDate({ optional: true }),
    endDate: Field.isoDate({ optional: true }),
  },
  {
    description: "Create a new tournament",
    tags: ["tournament"],
  },
);

export type CreateTournamentRequest = z.infer<typeof createTournamentSchema.schema>;

// ─── Tournament registration ──────────────────────────────────────────────────

export const tournamentRegistrationSchema = defineSchema(
  "tournamentRegistration",
  {
    username: Field.text({ min: 1, max: 50, requiredMessage: "Username is required" }),
    email: Field.email(),
    discordHandle: Validators.discordHandle({ optional: true }),
    agreedToRules: Field.mustBeTrue("You must agree to the tournament rules"),
  },
  { description: "Tournament registration form", tags: ["tournament"] },
);

export type TournamentRegistration = z.infer<typeof tournamentRegistrationSchema.schema>;

// ─── Tournament filters ───────────────────────────────────────────────────────

export const tournamentFiltersSchema = defineSchema(
  "tournamentFilters",
  {
    gameType: z.string().optional(),
    status: z
      .enum(["draft", "registration_open", "registration_closed", "in_progress", "completed", "cancelled"])
      .optional(),
    visibility: z.enum(["public", "private", "invite_only"]).optional(),
    tournamentType: z
      .enum(["single_elimination", "double_elimination", "round_robin", "swiss"])
      .optional(),
    minEntryFee: z.number().min(0).optional(),
    maxEntryFee: z.number().min(0).optional(),
    search: Field.optionalText({ max: 100 }),
    sortBy: z.enum(["date", "prize_pool", "participants"]).optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    page: Validators.page(),
    limit: Validators.limit({ max: 100 }),
  },
  { description: "Tournament list filter parameters", tags: ["tournament"] },
);

export type TournamentFilters = z.infer<typeof tournamentFiltersSchema.schema>;
