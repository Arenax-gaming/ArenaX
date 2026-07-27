/**
 * ArenaX — Custom Domain Validators
 *
 * Reusable Zod refinements for ArenaX-specific business rules.
 * Each validator returns a Zod schema so it can be composed inline
 * or used standalone.
 *
 * Usage:
 *   import { Validators } from "@/lib/validation/validators";
 *
 *   const schema = z.object({
 *     destination: Validators.stellarAddress(),
 *     gameType:    Validators.gameType(),
 *     eloRating:   Validators.eloRating(),
 *   });
 */

import { z } from "zod";

// ─── Stellar / blockchain validators ─────────────────────────────────────────

/**
 * Correct Stellar public key regex — base32 alphabet (A–Z, 2–7), 55 chars + leading G.
 * RFC 4648 base32: uppercase letters A-Z and digits 2-7.
 */
export const STELLAR_PUBLIC_KEY_REGEX = /^G[A-Z2-7]{55}$/;

/**
 * Stellar transaction memo — max 28 UTF-8 bytes.
 * Uses TextEncoder for accurate byte counting (handles multi-byte chars).
 */
function stellarMemoByteLength(memo: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(memo).length;
  }
  // Fallback: count characters (safe approximation for ASCII memos)
  return memo.length;
}

export const Validators = {
  // ── Blockchain ──────────────────────────────────────────────────────────────

  /**
   * Validates a Stellar public key (G… 56-char base32).
   * @example Validators.stellarAddress()
   */
  stellarAddress(
    options: { message?: string; optional?: boolean } = {},
  ): z.ZodString | z.ZodOptional<z.ZodString> {
    const schema = z
      .string()
      .min(1, "Destination address is required")
      .regex(
        STELLAR_PUBLIC_KEY_REGEX,
        options.message ??
          "Enter a valid Stellar public key (starts with G, 56 characters, base32)",
      );

    if (options.optional) return schema.optional();
    return schema;
  },

  /**
   * Validates a Stellar transaction memo (max 28 UTF-8 bytes).
   * @example Validators.stellarMemo()
   */
  stellarMemo(
    options: { message?: string } = {},
  ): z.ZodOptional<z.ZodString> {
    return z
      .string()
      .optional()
      .refine(
        (v) => !v || stellarMemoByteLength(v) <= 28,
        options.message ?? "Memo must be 28 bytes or fewer",
      ) as z.ZodOptional<z.ZodString>;
  },

  // ── Game / tournament domain ────────────────────────────────────────────────

  /**
   * Known ArenaX game types.
   */
  gameType(
    options: { message?: string } = {},
  ): z.ZodString {
    const KNOWN_GAME_TYPES = [
      "fps",
      "battle_royale",
      "moba",
      "rts",
      "fighting",
      "sports",
      "card",
      "custom",
    ] as const;

    return z
      .string()
      .min(1, "Game type is required")
      .refine(
        (v) => KNOWN_GAME_TYPES.includes(v as (typeof KNOWN_GAME_TYPES)[number]) || v.length > 0,
        options.message ?? `Game type must be one of: ${KNOWN_GAME_TYPES.join(", ")}`,
      );
  },

  /**
   * Tournament entry fee — non-negative number (0 = free).
   * @example Validators.entryFee()
   */
  entryFee(
    options: { maxFee?: number; message?: string } = {},
  ): z.ZodNumber {
    const max = options.maxFee ?? 10_000;
    return z
      .number()
      .min(0, "Entry fee cannot be negative")
      .max(max, options.message ?? `Entry fee cannot exceed ${max}`)
      .finite();
  },

  /**
   * Prize pool — must be ≥ 0.
   */
  prizePool(
    options: { message?: string } = {},
  ): z.ZodNumber {
    return z
      .number()
      .min(0, options.message ?? "Prize pool cannot be negative")
      .finite();
  },

  /**
   * Max participants — must be a positive power of 2 (for bracket tournaments)
   * or a positive integer (for round-robin/swiss).
   * @example Validators.maxParticipants()
   * @example Validators.maxParticipants({ allowAny: true })
   */
  maxParticipants(
    options: {
      min?: number;
      max?: number;
      allowAny?: boolean;
      message?: string;
    } = {},
  ): z.ZodNumber {
    const min = options.min ?? 2;
    const max = options.max ?? 1024;

    let schema = z
      .number()
      .int("Participant count must be a whole number")
      .min(min, `Minimum ${min} participants required`)
      .max(max, options.message ?? `Maximum ${max} participants allowed`);

    if (!options.allowAny) {
      // Power of 2 validation for bracket tournaments
      schema = schema.refine(
        (v) => v >= min && (v & (v - 1)) === 0,
        options.message ??
          "Participant count must be a power of 2 (e.g. 4, 8, 16, 32, 64, 128)",
      );
    }

    return schema;
  },

  // ── Player / profile domain ─────────────────────────────────────────────────

  /**
   * ELO rating — non-negative integer, typically 0–4000.
   * @example Validators.eloRating()
   */
  eloRating(
    options: { min?: number; max?: number; message?: string } = {},
  ): z.ZodNumber {
    return z
      .number()
      .int("ELO rating must be a whole number")
      .min(options.min ?? 0, options.message ?? "ELO rating cannot be negative")
      .max(options.max ?? 9_999, options.message ?? "ELO rating is out of range");
  },

  /**
   * Discord handle — either `username#1234` (legacy) or modern username format.
   * @example Validators.discordHandle()
   */
  discordHandle(
    options: { message?: string; optional?: boolean } = {},
  ): z.ZodString | z.ZodOptional<z.ZodString> {
    const schema = z
      .string()
      .max(100, "Discord handle is too long")
      .refine(
        (v) =>
          /^.{1,32}#[0-9]{4}$/.test(v) || // legacy user#1234
          /^[a-z0-9_.]{2,32}$/.test(v),    // modern username
        options.message ?? "Enter a valid Discord handle (e.g. username#1234 or modernusername)",
      );

    if (options.optional) return schema.optional();
    return schema;
  },

  /**
   * Social link — optional, must be http/https when filled, and match the
   * expected domain pattern.
   * @example Validators.socialLink("twitter.com")
   */
  socialLink(
    domain?: string,
    options: { message?: string } = {},
  ): z.ZodOptional<z.ZodString> {
    return z
      .string()
      .optional()
      .refine(
        (v) => {
          if (!v) return true;
          if (!v.startsWith("http://") && !v.startsWith("https://")) return false;
          if (domain) {
            try {
              return new URL(v).hostname.includes(domain);
            } catch {
              return false;
            }
          }
          return true;
        },
        options.message ??
          (domain
            ? `Must be a valid ${domain} URL`
            : "Must be a valid URL starting with http:// or https://"),
      ) as z.ZodOptional<z.ZodString>;
  },

  // ── API request / admin domain ──────────────────────────────────────────────

  /**
   * Proof URL for score reports — must be http/https when provided.
   */
  proofUrl(
    options: { message?: string } = {},
  ): z.ZodOptional<z.ZodString> {
    return z
      .string()
      .optional()
      .refine(
        (v) => !v || v.startsWith("http://") || v.startsWith("https://"),
        options.message ?? "Proof URL must start with http:// or https://",
      ) as z.ZodOptional<z.ZodString>;
  },

  /**
   * Match score — non-negative integer.
   */
  matchScore(
    options: { message?: string } = {},
  ): z.ZodNumber {
    return z
      .number()
      .int(options.message ?? "Score must be a whole number")
      .min(0, options.message ?? "Score cannot be negative")
      .finite();
  },

  /**
   * Validates a UUID v4 string.
   * @example Validators.uuid()
   */
  uuid(
    options: { message?: string; optional?: boolean } = {},
  ): z.ZodString | z.ZodOptional<z.ZodString> {
    const schema = z
      .string()
      .uuid(options.message ?? "Must be a valid UUID");

    if (options.optional) return schema.optional();
    return schema;
  },

  /**
   * A pagination page number — positive integer.
   */
  page(options: { message?: string } = {}): z.ZodOptional<z.ZodNumber> {
    return z
      .number()
      .int(options.message ?? "Page must be a whole number")
      .min(1, options.message ?? "Page must be at least 1")
      .optional();
  },

  /**
   * A pagination limit — between 1 and a configurable maximum.
   */
  limit(
    options: { max?: number; message?: string } = {},
  ): z.ZodOptional<z.ZodNumber> {
    const max = options.max ?? 100;
    return z
      .number()
      .int("Limit must be a whole number")
      .min(1, "Limit must be at least 1")
      .max(max, options.message ?? `Limit cannot exceed ${max}`)
      .optional();
  },

  // ── Governance domain ───────────────────────────────────────────────────────

  /**
   * On-chain function argument map — must be a plain object.
   */
  contractArgs(
    options: { message?: string } = {},
  ): z.ZodRecord<z.ZodString, z.ZodUnknown> {
    return z.record(z.string(), z.unknown()).refine(
      (v) => v !== null && typeof v === "object" && !Array.isArray(v),
      options.message ?? "Contract arguments must be a key–value object",
    );
  },
} as const;
