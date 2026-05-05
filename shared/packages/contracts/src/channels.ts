import { z } from "zod";

import {
  channelAdvancedReportStatusSchema,
  channelAdvancedReportDetailSchema,
  channelAdvancedReportSummarySchema,
  channelInsightsSchema,
} from "./advanced-reports";

const isoDatetimeSchema = z.string().datetime();

export const channelEnrichmentStatusSchema = z.enum([
  "missing",
  "queued",
  "running",
  "completed",
  "failed",
  "stale",
]);

export const structuredChannelProfilePrimaryNicheSchema = z.enum([
  "beauty",
  "skincare",
  "fashion",
  "hair_nails_grwm",
  "lifestyle",
  "gaming",
  "commentary_reaction",
  "fitness",
  "food",
  "travel",
  "tech",
  "education",
  "entertainment",
  "news_politics",
  "activism",
  "sports",
  "automotive",
  "finance",
  "music",
  "parenting_family",
  "pets",
  "home_living",
  "other",
]);

export const structuredChannelProfileContentFormatSchema = z.enum([
  "long_form",
  "shorts",
  "mixed",
  "live_stream",
  "podcast",
  "clips",
]);

export const structuredChannelProfileBrandFitTagSchema = z.enum([
  "consumer_tech",
  "gaming_hardware",
  "beauty_skincare",
  "fashion_apparel",
  "fitness_wellness",
  "food_drink",
  "travel_hospitality",
  "finance_fintech",
  "education_productivity",
  "automotive",
  "family_parenting",
  "home_living",
  "pets",
  "sports_outdoors",
  "luxury",
  "entertainment_media",
]);

export const structuredChannelProfileBrandSafetyStatusSchema = z.enum([
  "low",
  "medium",
  "high",
  "unknown",
]);

export const structuredChannelProfileBrandSafetyFlagSchema = z.enum([
  "adult",
  "violence",
  "gambling",
  "politics",
  "profanity",
  "controversy",
]);

export const structuredChannelProfileSchema = z.object({
  primaryNiche: structuredChannelProfilePrimaryNicheSchema,
  secondaryNiches: z.array(structuredChannelProfilePrimaryNicheSchema).max(3),
  contentFormats: z.array(structuredChannelProfileContentFormatSchema).min(1).max(3),
  brandFitTags: z.array(structuredChannelProfileBrandFitTagSchema).max(8),
  language: z.string().trim().min(2).max(32).nullable(),
  geoHints: z.array(z.string().trim().min(2).max(64)).max(3),
  sponsorSignals: z.array(z.string().trim().min(1).max(120)).max(5),
  brandSafety: z.object({
    status: structuredChannelProfileBrandSafetyStatusSchema,
    flags: z.array(structuredChannelProfileBrandSafetyFlagSchema).max(5),
    rationale: z.string().trim().min(1).max(280),
  }),
});

// Compatibility aliases for newer backend code that imported the original names.
export const channelStructuredProfileSchema = structuredChannelProfileSchema;

export const channelEnrichmentSummarySchema = z.object({
  status: channelEnrichmentStatusSchema,
  updatedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  lastEnrichedAt: isoDatetimeSchema.nullable().optional(),
  lastError: z.string().nullable(),
});

const catalogMultiValueFilterSchema = z
  .array(z.string().trim().min(1).max(200))
  .min(1)
  .max(100)
  .optional();

const catalogMetricRangeValueSchema = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
);

type CatalogRangePayload = Partial<Record<
  | "youtubeVideoMedianViewsMin"
  | "youtubeVideoMedianViewsMax"
  | "youtubeShortsMedianViewsMin"
  | "youtubeShortsMedianViewsMax"
  | "youtubeFollowersMin"
  | "youtubeFollowersMax",
  number | undefined
>>;

function validateCatalogRange(
  payload: CatalogRangePayload,
  context: z.RefinementCtx,
  minKey: keyof CatalogRangePayload,
  maxKey: keyof CatalogRangePayload,
): void {
  const min = payload[minKey];
  const max = payload[maxKey];

  if (min !== undefined && max !== undefined && min > max) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${String(minKey)} cannot be greater than ${String(maxKey)}`,
      path: [minKey],
    });
  }
}

export const catalogChannelFiltersSchema = z.object({
  query: z.string().trim().max(200).optional(),
  countryRegion: catalogMultiValueFilterSchema,
  influencerVertical: catalogMultiValueFilterSchema,
  influencerType: catalogMultiValueFilterSchema,
  youtubeVideoMedianViewsMin: catalogMetricRangeValueSchema,
  youtubeVideoMedianViewsMax: catalogMetricRangeValueSchema,
  youtubeShortsMedianViewsMin: catalogMetricRangeValueSchema,
  youtubeShortsMedianViewsMax: catalogMetricRangeValueSchema,
  youtubeFollowersMin: catalogMetricRangeValueSchema,
  youtubeFollowersMax: catalogMetricRangeValueSchema,
  enrichmentStatus: z.array(channelEnrichmentStatusSchema).min(1).optional(),
  advancedReportStatus: z.array(channelAdvancedReportStatusSchema).min(1).optional(),
}).superRefine((payload, context) => {
  validateCatalogRange(payload, context, "youtubeVideoMedianViewsMin", "youtubeVideoMedianViewsMax");
  validateCatalogRange(payload, context, "youtubeShortsMedianViewsMin", "youtubeShortsMedianViewsMax");
  validateCatalogRange(payload, context, "youtubeFollowersMin", "youtubeFollowersMax");
});

export const channelEnrichmentDetailSchema = channelEnrichmentSummarySchema.extend({
  summary: z.string().nullable(),
  topics: z.array(z.string()).nullable(),
  brandFitNotes: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  structuredProfile: structuredChannelProfileSchema.nullable(),
});

export const listChannelsQuerySchema = catalogChannelFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const channelSummarySchema = z.object({
  id: z.uuid(),
  youtubeChannelId: z.string(),
  title: z.string(),
  handle: z.string().nullable(),
  youtubeUrl: z.string().nullable().optional(),
  socialMediaLink: z.string().nullable().optional(),
  platforms: z.array(z.string()).optional(),
  countryRegion: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  influencerVertical: z.string().nullable().optional(),
  influencerType: z.string().nullable().optional(),
  contentLanguage: z.string().nullable().optional(),
  youtubeEngagementRate: z.number().nullable().optional(),
  youtubeFollowers: z.string().nullable().optional(),
  youtubeVideoMedianViews: z.string().nullable().optional(),
  youtubeShortsMedianViews: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable(),
  enrichment: channelEnrichmentSummarySchema,
  advancedReport: channelAdvancedReportSummarySchema,
});

export const channelDetailSchema = channelSummarySchema.extend({
  description: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
  enrichment: channelEnrichmentDetailSchema,
  advancedReport: channelAdvancedReportDetailSchema,
  insights: channelInsightsSchema,
});

export const channelManualOverrideFieldSchema = z.enum([
  "title",
  "handle",
  "description",
  "thumbnailUrl",
]);

export const channelManualOverrideSetOperationSchema = z.object({
  field: channelManualOverrideFieldSchema,
  op: z.literal("set"),
  value: z.string().trim().max(5000).nullable(),
});

export const channelManualOverrideClearOperationSchema = z.object({
  field: channelManualOverrideFieldSchema,
  op: z.literal("clear"),
});

export const channelManualOverrideOperationSchema = z
  .union([
    channelManualOverrideSetOperationSchema,
    channelManualOverrideClearOperationSchema,
  ]);

export const patchChannelManualOverridesRequestSchema = z
  .object({
    operations: z.array(channelManualOverrideOperationSchema).min(1).max(20),
  })
  .superRefine((payload, context) => {
    const seen = new Set<string>();

    payload.operations.forEach((operation, index) => {
      if (seen.has(operation.field)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Each field can be patched at most once per request",
          path: ["operations", index, "field"],
        });
        return;
      }

      seen.add(operation.field);
    });
  });

export const patchChannelManualOverridesResponseSchema = z.object({
  channel: channelDetailSchema,
  applied: z.array(
    z.object({
      field: channelManualOverrideFieldSchema,
      op: z.enum(["set", "clear"]),
    }),
  ),
});

export const listChannelsResponseSchema = z.object({
  items: z.array(channelSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});

export const requestChannelEnrichmentResponseSchema = z.object({
  channelId: z.uuid(),
  enrichment: channelEnrichmentDetailSchema,
});

export type ListChannelsQuery = z.infer<typeof listChannelsQuerySchema>;
export type CatalogChannelFilters = z.infer<typeof catalogChannelFiltersSchema>;
export type ChannelSummary = z.infer<typeof channelSummarySchema>;
export type ChannelDetail = z.infer<typeof channelDetailSchema>;
export type ListChannelsResponse = z.infer<typeof listChannelsResponseSchema>;
export type ChannelEnrichmentStatus = z.infer<typeof channelEnrichmentStatusSchema>;
export type ChannelEnrichmentSummary = z.infer<typeof channelEnrichmentSummarySchema>;
export type ChannelEnrichmentDetail = z.infer<typeof channelEnrichmentDetailSchema>;
export type StructuredChannelProfile = z.infer<typeof structuredChannelProfileSchema>;
export type ChannelStructuredProfile = StructuredChannelProfile;
export type ChannelManualOverrideField = z.infer<typeof channelManualOverrideFieldSchema>;
export type ChannelManualOverrideOperation = z.infer<typeof channelManualOverrideOperationSchema>;
export type PatchChannelManualOverridesRequest = z.infer<
  typeof patchChannelManualOverridesRequestSchema
>;
export type PatchChannelManualOverridesResponse = z.infer<
  typeof patchChannelManualOverridesResponseSchema
>;
export type RequestChannelEnrichmentResponse = z.infer<
  typeof requestChannelEnrichmentResponseSchema
>;
