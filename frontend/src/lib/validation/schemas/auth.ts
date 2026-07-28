/**
 * Auth request validation schemas — built with the declarative Field API.
 *
 * These schemas validate API request *payloads* (what gets sent to the server),
 * complementing the form-level Zod schemas in lib/validations/auth.ts which
 * handle UI-specific fields like confirmPassword and agreeToTerms.
 */

import { z } from "zod";
import { Field, mustMatch, requiredWhen } from "../fields";
import { defineSchema, defineSchemaWithRefinements } from "../schema";

// ─── Login ────────────────────────────────────────────────────────────────────

export const loginRequestSchema = defineSchema(
  "loginRequest",
  {
    email: Field.email(),
    password: Field.passwordLogin(),
  },
  { description: "User login API request", tags: ["auth"] },
);

export type LoginRequest = z.infer<typeof loginRequestSchema.schema>;

// ─── Register ─────────────────────────────────────────────────────────────────

export const registerRequestSchema = defineSchemaWithRefinements(
  "registerRequest",
  {
    username: Field.username(),
    email: Field.email(),
    password: Field.password(),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  },
  (schema) =>
    schema.superRefine(mustMatch("password", "confirmPassword", "Passwords do not match")),
  { description: "User registration API request", tags: ["auth"] },
);

export type RegisterRequest = z.infer<typeof registerRequestSchema.schema>;

// ─── Password reset request ───────────────────────────────────────────────────

export const passwordResetRequestSchema = defineSchema(
  "passwordResetRequest",
  { email: Field.email() },
  { description: "Password reset email request", tags: ["auth"] },
);

export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema.schema>;

// ─── Password reset (set new password) ───────────────────────────────────────

export const passwordResetSchema = defineSchemaWithRefinements(
  "passwordReset",
  {
    token: Field.text({ requiredMessage: "Reset token is required" }),
    password: Field.password(),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  },
  (schema) =>
    schema.superRefine(mustMatch("password", "confirmPassword", "Passwords do not match")),
  { description: "Password reset with new password", tags: ["auth"] },
);

export type PasswordReset = z.infer<typeof passwordResetSchema.schema>;

// ─── Email verification ───────────────────────────────────────────────────────

export const emailVerificationSchema = defineSchema(
  "emailVerification",
  {
    token: Field.text({ requiredMessage: "Verification token is required" }),
  },
  { description: "Email verification token", tags: ["auth"] },
);

export type EmailVerification = z.infer<typeof emailVerificationSchema.schema>;

// ─── Profile update ───────────────────────────────────────────────────────────

export const profileUpdateSchema = defineSchemaWithRefinements(
  "profileUpdate",
  {
    username: Field.username().optional(),
    bio: Field.optionalText({ max: 280 }),
    avatar: Field.optionalText({ max: 2048 }),
    currentPassword: z.string().optional(),
    newPassword: Field.password().optional(),
    confirmNewPassword: z.string().optional(),
  },
  (schema) =>
    schema
      .superRefine(
        requiredWhen(
          (d) => !!(d.newPassword),
          "currentPassword",
          "Current password is required to change your password",
        ),
      )
      .superRefine(
        requiredWhen(
          (d) => !!(d.newPassword),
          "confirmNewPassword",
          "Please confirm your new password",
        ),
      )
      .superRefine(mustMatch("newPassword", "confirmNewPassword", "Passwords do not match")),
  { description: "User profile update", tags: ["auth", "profile"] },
);

export type ProfileUpdate = z.infer<typeof profileUpdateSchema.schema>;
