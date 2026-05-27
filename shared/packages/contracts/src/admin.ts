import { z } from "zod";

import { adminAdvancedReportRequestSummarySchema } from "./advanced-reports";
import { roleSchema, userTypeSchema } from "./auth";
import { csvImportBatchSummarySchema } from "./csv-imports";

const isoDatetimeSchema = z.string().datetime();
const accountPasswordSchema = z
  .string()
  .min(12)
  .max(128)
  .refine(
    (value) => /[A-Za-z]/.test(value) && /\d/.test(value),
    "Password must include at least one letter and one number",
  );

export const createAdminUserRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(200).optional(),
  role: roleSchema.default("user"),
  userType: userTypeSchema.default("campaign_manager"),
  password: accountPasswordSchema,
});

export const updateAdminUserProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).nullable().optional(),
  userType: userTypeSchema,
});

export const updateAdminUserPasswordRequestSchema = z.object({
  password: accountPasswordSchema,
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
  userType: userTypeSchema,
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

export const adminDashboardEnrichmentCountsSchema = z.object({
  missing: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  stale: z.number().int().nonnegative(),
});

export const adminDashboardEnrichmentSchema = z.object({
  totalCount: z.number().int().nonnegative(),
  enrichedCount: z.number().int().nonnegative(),
  notEnrichedCount: z.number().int().nonnegative(),
  counts: adminDashboardEnrichmentCountsSchema,
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
  enrichment: adminDashboardEnrichmentSchema,
});

export type CreateAdminUserRequest = z.infer<typeof createAdminUserRequestSchema>;
export type UpdateAdminUserProfileRequest = z.infer<typeof updateAdminUserProfileRequestSchema>;
export type UpdateAdminUserPasswordRequest = z.infer<typeof updateAdminUserPasswordRequestSchema>;
export type UpdateAdminUserYoutubeKeyRequest = z.infer<typeof updateAdminUserYoutubeKeyRequestSchema>;
export type UpdateAdminUserYoutubeKeyResponse = z.infer<typeof updateAdminUserYoutubeKeyResponseSchema>;
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>;
export type ListAdminUsersResponse = z.infer<typeof listAdminUsersResponseSchema>;
export type AdminDashboardApprovalsCounts = z.infer<typeof adminDashboardApprovalsCountsSchema>;
export type AdminDashboardImportsCounts = z.infer<typeof adminDashboardImportsCountsSchema>;
export type AdminDashboardUsers = z.infer<typeof adminDashboardUsersSchema>;
export type AdminDashboardEnrichmentCounts = z.infer<typeof adminDashboardEnrichmentCountsSchema>;
export type AdminDashboardEnrichment = z.infer<typeof adminDashboardEnrichmentSchema>;
export type AdminDashboardResponse = z.infer<typeof adminDashboardResponseSchema>;
