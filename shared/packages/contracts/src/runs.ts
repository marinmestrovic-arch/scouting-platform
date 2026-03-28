import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const runRequestStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const runResultSourceSchema = z.enum(["catalog", "discovery"]);

export const runMonthSchema = z.enum([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

export const runCampaignManagerSchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});

export const runMetadataInputSchema = z.object({
  campaignId: z.uuid(),
  campaignManagerUserId: z.uuid().optional(),
});

export const runMetadataResponseSchema = z.object({
  campaignId: z.uuid().nullable(),
  client: z.string().nullable(),
  market: z.string().nullable(),
  campaignManagerUserId: z.uuid().nullable(),
  campaignManager: runCampaignManagerSchema.nullable(),
  briefLink: z.string().nullable(),
  campaignName: z.string().nullable(),
  month: runMonthSchema.nullable(),
  year: z.number().int().nullable(),
  dealOwner: z.string().nullable(),
  dealName: z.string().nullable(),
  pipeline: z.string().nullable(),
  dealStage: z.string().nullable(),
  currency: z.string().nullable(),
  dealType: z.string().nullable(),
  activationType: z.string().nullable(),
  hubspotInfluencerType: z.string().nullable().optional(),
  hubspotInfluencerVertical: z.string().nullable().optional(),
  hubspotCountryRegion: z.string().nullable().optional(),
  hubspotLanguage: z.string().nullable().optional(),
});

export const createRunRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  query: z.string().trim().min(1).max(500),
  target: z.number().int().positive(),
  metadata: runMetadataInputSchema,
});

export const createRunResponseSchema = z.object({
  runId: z.uuid(),
  status: runRequestStatusSchema,
});

export const listRunsQuerySchema = z.object({
  campaignManagerUserId: z.uuid().optional(),
  client: z.string().trim().min(1).max(200).optional(),
  market: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const recentRunItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  query: z.string(),
  target: z.number().int().positive().nullable(),
  status: runRequestStatusSchema,
  lastError: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
  startedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  resultCount: z.number().int().nonnegative(),
  metadata: runMetadataResponseSchema,
});

export const runFilterOptionsSchema = z.object({
  campaignManagers: z.array(runCampaignManagerSchema),
  clients: z.array(z.string()),
  markets: z.array(z.string()),
});

export const listRecentRunsResponseSchema = z.object({
  items: z.array(recentRunItemSchema),
  filterOptions: runFilterOptionsSchema,
});

export const runResultChannelSchema = z.object({
  id: z.uuid(),
  youtubeChannelId: z.string(),
  title: z.string(),
  handle: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
});

export const runResultItemSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  rank: z.number().int().min(1),
  source: runResultSourceSchema,
  createdAt: isoDatetimeSchema,
  channel: runResultChannelSchema,
});

export const runStatusResponseSchema = z.object({
  id: z.uuid(),
  requestedByUserId: z.uuid(),
  name: z.string(),
  query: z.string(),
  target: z.number().int().positive().nullable(),
  status: runRequestStatusSchema,
  lastError: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
  startedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  metadata: runMetadataResponseSchema,
  results: z.array(runResultItemSchema),
});

export const campaignManagerOptionSchema = runCampaignManagerSchema;

export const listCampaignManagersResponseSchema = z.object({
  items: z.array(campaignManagerOptionSchema),
});

export type RunRequestStatus = z.infer<typeof runRequestStatusSchema>;
export type RunResultSource = z.infer<typeof runResultSourceSchema>;
export type RunMonth = z.infer<typeof runMonthSchema>;
export type RunCampaignManager = z.infer<typeof runCampaignManagerSchema>;
export type RunMetadataInput = z.infer<typeof runMetadataInputSchema>;
export type RunMetadataResponse = z.infer<typeof runMetadataResponseSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
export type RecentRunItem = z.infer<typeof recentRunItemSchema>;
export type RunFilterOptions = z.infer<typeof runFilterOptionsSchema>;
export type ListRecentRunsResponse = z.infer<typeof listRecentRunsResponseSchema>;
export type RunResultChannel = z.infer<typeof runResultChannelSchema>;
export type RunResultItem = z.infer<typeof runResultItemSchema>;
export type RunStatusResponse = z.infer<typeof runStatusResponseSchema>;
export type CampaignManagerOption = z.infer<typeof campaignManagerOptionSchema>;
export type ListCampaignManagersResponse = z.infer<typeof listCampaignManagersResponseSchema>;
