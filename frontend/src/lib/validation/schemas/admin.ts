/**
 * Admin request validation schemas.
 */

import { z } from "zod";
import { Field } from "../fields";
import { Validators } from "../validators";
import { defineSchema } from "../schema";

// ─── Resolve dispute ──────────────────────────────────────────────────────────

export const resolveDisputeSchema = defineSchema(
  "resolveDispute",
  {
    status: Field.enum(["RESOLVED", "DISMISSED", "VOIDED"] as const, {
      message: "Select a valid resolution status",
    }),
    resolution: Field.text({
      min: 10,
      max: 2000,
      requiredMessage: "Resolution details are required",
      minMessage: "Please provide at least 10 characters of detail",
    }),
    winnerOverrideId: Validators.uuid({ optional: true }),
  },
  { description: "Resolve a match dispute", tags: ["admin", "dispute"] },
);

export type ResolveDisputeRequest = z.infer<typeof resolveDisputeSchema.schema>;

// ─── Process KYC ─────────────────────────────────────────────────────────────

export const processKycSchema = defineSchema(
  "processKyc",
  {
    status: Field.enum(["PENDING", "APPROVED", "REJECTED", "ESCALATED"] as const, {
      message: "Select a valid KYC status",
    }),
    notes: Field.optionalText({ max: 2000 }),
  },
  { description: "Process a KYC review", tags: ["admin", "kyc"] },
);

export type ProcessKycRequest = z.infer<typeof processKycSchema.schema>;

// ─── Audit log filters ────────────────────────────────────────────────────────

export const auditLogFiltersSchema = defineSchema(
  "auditLogFilters",
  {
    adminId: Validators.uuid({ optional: true }),
    action: z.string().optional(),
    targetType: z.string().optional(),
    targetId: z.string().optional(),
    from: Field.isoDate({ optional: true }),
    to: Field.isoDate({ optional: true }),
    page: Validators.page(),
    limit: Validators.limit({ max: 200 }),
  },
  { description: "Audit log filter parameters", tags: ["admin"] },
);

export type AuditLogFilters = z.infer<typeof auditLogFiltersSchema.schema>;

// ─── KYC filters ─────────────────────────────────────────────────────────────

export const kycFiltersSchema = defineSchema(
  "kycFilters",
  {
    status: z.enum(["PENDING", "APPROVED", "REJECTED", "ESCALATED"]).optional(),
    page: Validators.page(),
    limit: Validators.limit({ max: 100 }),
  },
  { description: "KYC review filter parameters", tags: ["admin", "kyc"] },
);

export type KycFilters = z.infer<typeof kycFiltersSchema.schema>;
