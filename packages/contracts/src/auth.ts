import { z } from "zod";

export const roleSchema = z.enum(["admin", "user"]);

export const credentialsSignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type Role = z.infer<typeof roleSchema>;
export type CredentialsSignInInput = z.infer<typeof credentialsSignInSchema>;
