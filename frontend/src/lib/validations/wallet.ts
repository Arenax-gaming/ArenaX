import { z } from "zod";

export const STELLAR_ADDRESS_REGEX = /^G[A-Z0-9]{55}$/;

export const withdrawSchema = z.object({
  asset: z.enum(["XLM", "USDC", "ARENAX"]),
  amount: z
    .string()
    .min(1, "Amount is required")
    .refine(
      (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0;
      },
      { message: "Enter a valid amount greater than 0" }
    ),
  destination: z
    .string()
    .min(1, "Destination address is required")
    .regex(
      STELLAR_ADDRESS_REGEX,
      "Destination must be a valid Stellar public key (starts with G, 56 chars)"
    ),
  memo: z.string().max(28, "Memo must be 28 characters or less").optional(),
});

export type WithdrawFormData = z.infer<typeof withdrawSchema>;

export const depositSchema = z.object({
  asset: z.enum(["XLM", "USDC", "ARENAX"]),
  amount: z
    .string()
    .optional()
    .refine(
      (v) => {
        if (!v || v === "0" || v === "") return true;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0;
      },
      { message: "Enter a valid amount" }
    ),
});

export type DepositFormData = z.infer<typeof depositSchema>;
