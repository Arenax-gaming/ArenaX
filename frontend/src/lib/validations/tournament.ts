import { z } from "zod";

export const tournamentRegistrationSchema = z.object({
  username: z
    .string()
    .min(1, "Username is required")
    .max(50, "Username is too long"),
  email: z
    .string()
    .min(1, "Email is required")
    .email("Invalid email address"),
  discordHandle: z
    .string()
    .max(100, "Discord handle is too long")
    .optional(),
  agreedToRules: z.boolean().refine((v) => v === true, {
    message: "You must agree to the tournament rules",
  }),
});

export type TournamentRegistrationFormData = z.infer<
  typeof tournamentRegistrationSchema
>;
