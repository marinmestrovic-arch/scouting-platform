import { z } from "zod";

import { roleSchema } from "./auth";

const isoDatetimeSchema = z.string().datetime();

export const createAdminUserRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(200).optional(),
  role: roleSchema.default("user"),
  password: z.string().min(8).max(128),
});

export const updateAdminUserPasswordRequestSchema = z.object({
  password: z.string().min(8).max(128),
});

export const updateAdminUserYoutubeKeyRequestSchema = z.object({
  youtubeApiKey: z.string().trim().min(1).max(2048),
});

export const adminUserResponseSchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: roleSchema,
  isActive: z.boolean(),
  youtubeKeyAssigned: z.boolean(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});

export const listAdminUsersResponseSchema = z.object({
  users: z.array(adminUserResponseSchema),
});

export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequestSchema>;
export type UpdateAdminUserPasswordRequest = z.infer<typeof updateAdminUserPasswordRequestSchema>;
export type UpdateAdminUserYoutubeKeyRequest = z.infer<typeof updateAdminUserYoutubeKeyRequestSchema>;
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>;
