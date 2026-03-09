import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const latestCompletedAdvancedReportSchema = z.object({
  requestId: z.uuid(),
  completedAt: isoDatetimeSchema,
  ageDays: z.number().int().nonnegative(),
  withinFreshWindow: z.boolean(),
});

export const advancedReportRequestStatusSchema = z.enum([
  "pending_approval",
  "approved",
  "rejected",
  "queued",
  "running",
  "completed",
  "failed",
]);

export const channelAdvancedReportStatusSchema = z.enum([
  "missing",
  "pending_approval",
  "approved",
  "rejected",
  "queued",
  "running",
  "completed",
  "failed",
  "stale",
]);

export const channelAudienceCountrySchema = z.object({
  countryCode: z.string().trim().min(2).max(3),
  countryName: z.string().trim().min(1).max(200),
  percentage: z.number().min(0).max(100),
});

export const channelAudienceGenderAgeSchema = z.object({
  gender: z.string().trim().min(1).max(50),
  ageRange: z.string().trim().min(1).max(50),
  percentage: z.number().min(0).max(100),
});

export const channelAudienceInterestSchema = z.object({
  label: z.string().trim().min(1).max(200),
  score: z.number().nullable(),
});

export const channelEstimatedPriceSchema = z.object({
  currencyCode: z.string().trim().min(1).max(10).nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
});

export const channelBrandMentionSchema = z.object({
  brandName: z.string().trim().min(1).max(200),
});

export const channelInsightsSchema = z.object({
  audienceCountries: z.array(channelAudienceCountrySchema),
  audienceGenderAge: z.array(channelAudienceGenderAgeSchema),
  audienceInterests: z.array(channelAudienceInterestSchema),
  estimatedPrice: channelEstimatedPriceSchema.nullable(),
  brandMentions: z.array(channelBrandMentionSchema),
});

export const channelAdvancedReportSummarySchema = z.object({
  requestId: z.uuid().nullable(),
  status: channelAdvancedReportStatusSchema,
  updatedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  lastError: z.string().nullable(),
});

export const channelAdvancedReportDetailSchema = channelAdvancedReportSummarySchema.extend({
  requestedAt: isoDatetimeSchema.nullable(),
  reviewedAt: isoDatetimeSchema.nullable(),
  decisionNote: z.string().nullable(),
  lastCompletedReport: latestCompletedAdvancedReportSchema.nullable(),
});

export const requestAdvancedReportResponseSchema = z.object({
  channelId: z.uuid(),
  advancedReport: channelAdvancedReportDetailSchema,
});

export const decideAdvancedReportRequestSchema = z.object({
  decisionNote: z.string().trim().min(1).max(1000).optional(),
});

export const adminAdvancedReportListQuerySchema = z.object({
  status: advancedReportRequestStatusSchema.optional(),
});

export const adminAdvancedReportActorSchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});

export const adminAdvancedReportChannelSchema = z.object({
  id: z.uuid(),
  youtubeChannelId: z.string(),
  title: z.string(),
});

export const adminAdvancedReportRequestSummarySchema = z.object({
  id: z.uuid(),
  channel: adminAdvancedReportChannelSchema,
  requestedBy: adminAdvancedReportActorSchema,
  reviewedBy: adminAdvancedReportActorSchema.nullable(),
  status: advancedReportRequestStatusSchema,
  decisionNote: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
  reviewedAt: isoDatetimeSchema.nullable(),
  startedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  lastCompletedReport: latestCompletedAdvancedReportSchema.nullable(),
});

export const listAdminAdvancedReportRequestsResponseSchema = z.object({
  items: z.array(adminAdvancedReportRequestSummarySchema),
});

export const adminAdvancedReportRequestDetailSchema = adminAdvancedReportRequestSummarySchema.extend({
  insights: channelInsightsSchema,
  rawPayload: z.unknown().nullable(),
});

export type AdvancedReportRequestStatus = z.infer<typeof advancedReportRequestStatusSchema>;
export type ChannelAdvancedReportStatus = z.infer<typeof channelAdvancedReportStatusSchema>;
export type ChannelAudienceCountry = z.infer<typeof channelAudienceCountrySchema>;
export type ChannelAudienceGenderAge = z.infer<typeof channelAudienceGenderAgeSchema>;
export type ChannelAudienceInterest = z.infer<typeof channelAudienceInterestSchema>;
export type ChannelEstimatedPrice = z.infer<typeof channelEstimatedPriceSchema>;
export type ChannelBrandMention = z.infer<typeof channelBrandMentionSchema>;
export type LatestCompletedAdvancedReport = z.infer<typeof latestCompletedAdvancedReportSchema>;
export type ChannelInsights = z.infer<typeof channelInsightsSchema>;
export type ChannelAdvancedReportSummary = z.infer<typeof channelAdvancedReportSummarySchema>;
export type ChannelAdvancedReportDetail = z.infer<typeof channelAdvancedReportDetailSchema>;
export type RequestAdvancedReportResponse = z.infer<typeof requestAdvancedReportResponseSchema>;
export type DecideAdvancedReportRequest = z.infer<typeof decideAdvancedReportRequestSchema>;
export type AdminAdvancedReportListQuery = z.infer<typeof adminAdvancedReportListQuerySchema>;
export type AdminAdvancedReportActor = z.infer<typeof adminAdvancedReportActorSchema>;
export type AdminAdvancedReportChannel = z.infer<typeof adminAdvancedReportChannelSchema>;
export type AdminAdvancedReportRequestSummary = z.infer<
  typeof adminAdvancedReportRequestSummarySchema
>;
export type ListAdminAdvancedReportRequestsResponse = z.infer<
  typeof listAdminAdvancedReportRequestsResponseSchema
>;
export type AdminAdvancedReportRequestDetail = z.infer<
  typeof adminAdvancedReportRequestDetailSchema
>;
