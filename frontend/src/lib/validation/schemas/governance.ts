/**
 * Governance request validation schemas.
 */

import { z } from "zod";
import { Field } from "../fields";
import { Validators } from "../validators";
import { defineSchema } from "../schema";

// ─── Create proposal ──────────────────────────────────────────────────────────

export const createProposalSchema = defineSchema(
  "createProposal",
  {
    target_contract: Validators.stellarAddress({
      message: "Target contract must be a valid Stellar address",
    }),
    function: Field.text({
      min: 1,
      max: 200,
      requiredMessage: "Function name is required",
    }),
    args: Validators.contractArgs(),
    description: Field.optionalText({ max: 2000 }),
    execute_after: z.number().int().min(0).optional(),
  },
  { description: "Create a governance proposal", tags: ["governance"] },
);

export type CreateProposalRequest = z.infer<typeof createProposalSchema.schema>;

// ─── Vote on proposal ─────────────────────────────────────────────────────────

export const voteOnProposalSchema = defineSchema(
  "voteOnProposal",
  {
    proposalId: Field.text({ requiredMessage: "Proposal ID is required" }),
    choice: Field.enum(["yes", "no", "abstain"] as const, {
      message: "Vote must be yes, no, or abstain",
    }),
    signature: z.string().optional(),
  },
  { description: "Vote on a governance proposal", tags: ["governance"] },
);

export type VoteOnProposalRequest = z.infer<typeof voteOnProposalSchema.schema>;
