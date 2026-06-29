import { z } from "zod";

export const MAX_BIO_LENGTH = 280;

export const profileBioSchema = z.object({
  bio: z
    .string()
    .max(MAX_BIO_LENGTH, `Bio must be ${MAX_BIO_LENGTH} characters or less`)
    .optional(),
});

export type ProfileBioFormData = z.infer<typeof profileBioSchema>;
