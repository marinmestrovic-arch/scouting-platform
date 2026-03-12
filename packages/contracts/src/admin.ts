import { z } from "zod";

import { adminAdvancedReportRequestSummarySchema } from "./advanced-reports";
import { roleSchema } from "./auth";
import { csvImportBatchSummarySchema } from "./csv-imports";

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

export const updateAdminUserYoutubeKeyResponseSchema = z.object({
  ok: z.literal(true),
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

export const adminDashboardApprovalsCountsSchema = z.object({
  pendingApproval: z.number().int().nonnegative(),
  approved: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const adminDashboardImportsCountsSchema = z.object({
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const adminDashboardUsersSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  activeCount: z.number().int().nonnegative(),
  adminCount: z.number().int().nonnegative(),
  missingYoutubeKeyCount: z.number().int().nonnegative(),
  missingYoutubeKeyPreview: z.array(adminUserResponseSchema).max(5),
});

export const adminDashboardResponseSchema = z.object({
  generatedAt: isoDatetimeSchema,
  approvals: z.object({
    counts: adminDashboardApprovalsCountsSchema,
    pendingPreview: z.array(adminAdvancedReportRequestSummarySchema).max(5),
  }),
  imports: z.object({
    counts: adminDashboardImportsCountsSchema,
    attentionPreview: z.array(csvImportBatchSummarySchema).max(5),
  }),
  users: adminDashboardUsersSchema,
});

export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequestSchema>;
export type UpdateAdminUserPasswordRequest = z.infer<typeof updateAdminUserPasswordRequestSchema>;
export type UpdateAdminUserYoutubeKeyRequest = z.infer<typeof updateAdminUserYoutubeKeyRequestSchema>;
export type UpdateAdminUserYoutubeKeyResponse = z.infer<typeof updateAdminUserYoutubeKeyResponseSchema>;
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>;
export type ListAdminUsersResponse = z.infer<typeof listAdminUsersResponseSchema>;
export type AdminDashboardApprovalsCounts = z.infer<typeof adminDashboardApprovalsCountsSchema>;
export type AdminDashboardImportsCounts = z.infer<typeof adminDashboardImportsCountsSchema>;
export type AdminDashboardUsers = z.infer<typeof adminDashboardUsersSchema>;
export type AdminDashboardResponse = z.infer<typeof adminDashboardResponseSchema>;
