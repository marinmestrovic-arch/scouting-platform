import { z } from "zod";

import {
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

export const channelEnrichmentSummarySchema = z.object({
  status: channelEnrichmentStatusSchema,
  updatedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  lastError: z.string().nullable(),
});

export const channelEnrichmentDetailSchema = channelEnrichmentSummarySchema.extend({
  summary: z.string().nullable(),
  topics: z.array(z.string()).nullable(),
  brandFitNotes: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const listChannelsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(200).optional(),
});

export const channelSummarySchema = z.object({
  id: z.uuid(),
  youtubeChannelId: z.string(),
  title: z.string(),
  handle: z.string().nullable(),
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
export type ChannelSummary = z.infer<typeof channelSummarySchema>;
export type ChannelDetail = z.infer<typeof channelDetailSchema>;
export type ListChannelsResponse = z.infer<typeof listChannelsResponseSchema>;
export type ChannelEnrichmentStatus = z.infer<typeof channelEnrichmentStatusSchema>;
export type ChannelEnrichmentSummary = z.infer<typeof channelEnrichmentSummarySchema>;
export type ChannelEnrichmentDetail = z.infer<typeof channelEnrichmentDetailSchema>;
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
