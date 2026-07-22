import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const HUBSPOT_IMPORT_SCHEMA_VERSION = "week7-hubspot-import-v2" as const;
export const HUBSPOT_IMPORT_HEADER = [
  "Contact Type",
  "Campaign Name",
  "Month",
  "Year",
  "Client name",
  "Deal owner",
  "Deal name",
  "Pipeline",
  "Deal stage",
  "Currency",
  "Deal Type",
  "Activation Type",
  "First Name",
  "Last Name",
  "Email",
  "Phone Number",
  "Influencer Type",
  "Influencer Vertical",
  "Country/Region",
  "Language",
] as const;

export const hubspotImportBatchStatusSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "submitting",
  "submitted",
  "processing",
  "completed",
  "completed_with_errors",
  "failed",
]);

export const hubspotImportBatchRowStatusSchema = z.enum([
  "pending",
  "prepared",
  "submitting",
  "synced",
  "failed",
  "skipped",
]);

export const hubspotDeliveryModeSchema = z.enum([
  "csv_fallback",
  "direct_object_api",
]);

export const hubspotAssociationStatusSchema = z.enum([
  "pending",
  "associated",
  "failed",
  "not_required",
]);

export const hubspotImportBatchActorSchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});

export const createHubspotImportBatchRequestSchema = z.object({
  runId: z.uuid(),
  deliveryMode: hubspotDeliveryModeSchema.optional(),
});

export const hubspotImportBlockerSchema = z.object({
  scope: z.enum(["run", "channel", "contact"]),
  runId: z.uuid(),
  channelId: z.uuid().nullable(),
  contactEmail: z.string().email().nullable(),
  field: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

export const hubspotImportBatchValidationErrorSchema = z.object({
  error: z.literal("HubSpot import batch has missing required fields"),
  blockers: z.array(hubspotImportBlockerSchema).min(1),
});

export const hubspotImportBatchRunSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const hubspotImportBatchRowSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  channelTitle: z.string(),
  contactEmail: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  influencerType: z.string(),
  influencerVertical: z.string(),
  countryRegion: z.string(),
  language: z.string(),
  status: hubspotImportBatchRowStatusSchema,
  errorMessage: z.string().nullable(),
  hubspotContactId: z.string().trim().min(1).nullable().optional(),
  hubspotDealId: z.string().trim().min(1).nullable().optional(),
  hubspotContactUrl: z.string().url().nullable().optional(),
  hubspotDealUrl: z.string().url().nullable().optional(),
  externalKey: z.string().trim().min(1).nullable().optional(),
  associationStatus: hubspotAssociationStatusSchema.nullable().optional(),
  retryable: z.boolean().optional(),
  attemptCount: z.number().int().nonnegative().optional(),
  providerErrorCode: z.string().trim().min(1).nullable().optional(),
  providerCorrelationId: z.string().trim().min(1).nullable().optional(),
  submittedAt: isoDatetimeSchema.nullable().optional(),
  completedAt: isoDatetimeSchema.nullable().optional(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});

export const hubspotImportBatchSummarySchema = z.object({
  id: z.uuid(),
  run: hubspotImportBatchRunSchema,
  fileName: z.string().trim().min(1),
  schemaVersion: z.string().trim().min(1),
  status: hubspotImportBatchStatusSchema,
  totalRowCount: z.number().int().nonnegative(),
  preparedRowCount: z.number().int().nonnegative(),
  failedRowCount: z.number().int().nonnegative(),
  syncedRowCount: z.number().int().nonnegative().optional(),
  deliveryMode: hubspotDeliveryModeSchema.optional(),
  portalId: z.string().trim().min(1).nullable().optional(),
  externalJobId: z.string().trim().min(1).nullable().optional(),
  externalStatus: z.string().trim().min(1).nullable().optional(),
  submittedAt: isoDatetimeSchema.nullable().optional(),
  lastPolledAt: isoDatetimeSchema.nullable().optional(),
  providerCorrelationId: z.string().trim().min(1).nullable().optional(),
  providerResultSummary: z.record(z.string(), z.unknown()).nullable().optional(),
  retryCount: z.number().int().nonnegative().optional(),
  reusedActiveBatch: z.boolean().optional(),
  lastError: z.string().nullable(),
  requestedBy: hubspotImportBatchActorSchema,
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
  startedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
});

export const hubspotImportBatchDetailSchema = hubspotImportBatchSummarySchema.extend({
  rows: z.array(hubspotImportBatchRowSchema),
});

export const listHubspotImportBatchesResponseSchema = z.object({
  items: z.array(hubspotImportBatchSummarySchema),
});

export const retryHubspotImportBatchRequestSchema = z.object({
  scope: z.literal("failed_rows").default("failed_rows"),
});

export const retryHubspotImportBatchResponseSchema = z.object({
  batch: hubspotImportBatchSummarySchema,
  retriedRowCount: z.number().int().positive(),
});

export type HubspotImportBatchStatus = z.infer<typeof hubspotImportBatchStatusSchema>;
export type HubspotImportBatchRowStatus = z.infer<typeof hubspotImportBatchRowStatusSchema>;
export type HubspotDeliveryMode = z.infer<typeof hubspotDeliveryModeSchema>;
export type HubspotAssociationStatus = z.infer<typeof hubspotAssociationStatusSchema>;
export type HubspotImportBatchActor = z.infer<typeof hubspotImportBatchActorSchema>;
export type CreateHubspotImportBatchRequest = z.infer<typeof createHubspotImportBatchRequestSchema>;
export type HubspotImportBlocker = z.infer<typeof hubspotImportBlockerSchema>;
export type HubspotImportBatchValidationError = z.infer<
  typeof hubspotImportBatchValidationErrorSchema
>;
export type HubspotImportBatchRun = z.infer<typeof hubspotImportBatchRunSchema>;
export type HubspotImportBatchRow = z.infer<typeof hubspotImportBatchRowSchema>;
export type HubspotImportBatchSummary = z.infer<typeof hubspotImportBatchSummarySchema>;
export type HubspotImportBatchDetail = z.infer<typeof hubspotImportBatchDetailSchema>;
export type ListHubspotImportBatchesResponse = z.infer<
  typeof listHubspotImportBatchesResponseSchema
>;
export type RetryHubspotImportBatchRequest = z.infer<
  typeof retryHubspotImportBatchRequestSchema
>;
export type RetryHubspotImportBatchResponse = z.infer<
  typeof retryHubspotImportBatchResponseSchema
>;
