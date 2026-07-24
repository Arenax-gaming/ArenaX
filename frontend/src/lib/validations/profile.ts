import { z } from "zod";

export const MAX_BIO_LENGTH = 280;

const urlField = z
  .string()
  .optional()
  .refine(
    (v) => !v || v.startsWith("https://") || v.startsWith("http://"),
    "Must be a valid URL starting with http:// or https://"
  );

// ─── Bio-only (used inline in ProfileBio) ─────────────────────────────────────

export const profileBioSchema = z.object({
  bio: z
    .string()
    .max(MAX_BIO_LENGTH, `Bio must be ${MAX_BIO_LENGTH} characters or less`)
    .optional(),
});

export type ProfileBioFormData = z.infer<typeof profileBioSchema>;

// ─── Full profile edit ────────────────────────────────────────────────────────

export const profileEditSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(20, "Username must be at most 20 characters")
    .regex(
      /^[a-zA-Z0-9]+$/,
      "Username can only contain letters and numbers"
    ),
  bio: z
    .string()
    .max(MAX_BIO_LENGTH, `Bio must be ${MAX_BIO_LENGTH} characters or less`)
    .optional(),
  twitter: urlField,
  discord: z.string().max(100, "Discord handle is too long").optional(),
  twitch: urlField,
  github: urlField,
});

export type ProfileEditFormData = z.infer<typeof profileEditSchema>;
