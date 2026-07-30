/**
 * Wallet / transaction request validation schemas.
 */

import { z } from "zod";
import { Field } from "../fields";
import { Validators } from "../validators";
import { defineSchema } from "../schema";

// ─── Withdraw ─────────────────────────────────────────────────────────────────

export const withdrawSchema = defineSchema(
  "withdraw",
  {
    asset: Field.enum(["XLM", "USDC", "ARENAX"] as const, {
      message: "Select a valid asset",
    }),
    amount: Field.positiveAmountString(),
    destination: Validators.stellarAddress(),
    memo: Validators.stellarMemo(),
  },
  { description: "Withdraw assets from wallet", tags: ["wallet", "payment"] },
);

export type WithdrawRequest = z.infer<typeof withdrawSchema.schema>;

// ─── Deposit ──────────────────────────────────────────────────────────────────

export const depositSchema = defineSchema(
  "deposit",
  {
    asset: Field.enum(["XLM", "USDC", "ARENAX"] as const, {
      message: "Select a valid asset",
    }),
    amount: Field.nonNegativeAmountString(),
  },
  { description: "Deposit assets to wallet", tags: ["wallet", "payment"] },
);

export type DepositRequest = z.infer<typeof depositSchema.schema>;

// ─── Staking ──────────────────────────────────────────────────────────────────

export const stakeSchema = defineSchema(
  "stake",
  {
    asset: Field.enum(["ARENAX"] as const, {
      message: "Only ARENAX tokens can be staked",
    }),
    amount: Field.positiveAmountString({ message: "Enter a valid stake amount greater than 0" }),
    durationDays: Field.integer({
      min: 7,
      max: 365,
      minMessage: "Minimum staking duration is 7 days",
      maxMessage: "Maximum staking duration is 365 days",
    }),
  },
  { description: "Stake ARENAX tokens", tags: ["wallet", "staking"] },
);

export type StakeRequest = z.infer<typeof stakeSchema.schema>;
