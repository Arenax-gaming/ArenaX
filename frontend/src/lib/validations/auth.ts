import { z } from "zod";

// ─── Shared field validators ──────────────────────────────────────────────────

const emailField = z
  .string()
  .min(1, "Email is required")
  .email("Invalid email address");

const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^a-zA-Z0-9]/, "Password must contain at least one special character");

const usernameField = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be at most 20 characters")
  .regex(
    /^[a-zA-Z0-9]+$/,
    "Username can only contain letters and numbers (no spaces or special characters)"
  );

// ─── Login ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional().default(false),
});

export type LoginFormData = z.infer<typeof loginSchema>;

// ─── Register ─────────────────────────────────────────────────────────────────

export const registerSchema = z
  .object({
    username: usernameField,
    email: emailField,
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password"),
    agreeToTerms: z.boolean().refine((v) => v === true, {
      message: "You must agree to the terms",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterFormData = z.infer<typeof registerSchema>;

// ─── Password reset (request) ─────────────────────────────────────────────────

export const passwordResetRequestSchema = z.object({
  email: emailField,
});

export type PasswordResetRequestFormData = z.infer<typeof passwordResetRequestSchema>;

// ─── Password reset (set new password) ───────────────────────────────────────

export const passwordResetSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type PasswordResetFormData = z.infer<typeof passwordResetSchema>;

// ─── Account settings (email + username + optional password change) ───────────

export const accountSettingsSchema = z
  .object({
    email: emailField,
    username: usernameField,
    currentPassword: z.string().optional(),
    newPassword: z.string().optional(),
    confirmNewPassword: z.string().optional(),
    twoFactorEnabled: z.boolean(),
  })
  .superRefine((data, ctx) => {
    // If the user has started filling in the password change section, enforce full validation
    const anyPasswordFilled =
      data.currentPassword || data.newPassword || data.confirmNewPassword;

    if (anyPasswordFilled) {
      if (!data.currentPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Current password is required",
          path: ["currentPassword"],
        });
      }

      if (!data.newPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "New password is required",
          path: ["newPassword"],
        });
      } else {
        // Rerun password strength checks
        const strengthResult = passwordField.safeParse(data.newPassword);
        if (!strengthResult.success) {
          strengthResult.error.issues.forEach((issue) => {
            ctx.addIssue({ ...issue, path: ["newPassword"] });
          });
        }
      }

      if (data.newPassword && data.confirmNewPassword !== data.newPassword) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passwords do not match",
          path: ["confirmNewPassword"],
        });
      }
    }
  });

export type AccountSettingsFormData = z.infer<typeof accountSettingsSchema>;
