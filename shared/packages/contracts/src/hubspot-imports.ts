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
  "running",
  "completed",
  "failed",
]);

export const hubspotImportBatchRowStatusSchema = z.enum([
  "pending",
  "prepared",
  "failed",
]);

export const hubspotImportBatchActorSchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});

export const createHubspotImportBatchRequestSchema = z.object({
  runId: z.uuid(),
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

export type HubspotImportBatchStatus = z.infer<typeof hubspotImportBatchStatusSchema>;
export type HubspotImportBatchRowStatus = z.infer<typeof hubspotImportBatchRowStatusSchema>;
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
