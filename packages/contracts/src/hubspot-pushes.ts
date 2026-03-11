import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const hubspotPushBatchStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const hubspotPushBatchRowStatusSchema = z.enum([
  "pending",
  "pushed",
  "failed",
]);

export const hubspotPushBatchActorSchema = z.object({
  id: z.uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});

export const createHubspotPushBatchRequestSchema = z.object({
  channelIds: z.array(z.uuid()).min(1),
});

export const hubspotPushBatchScopeSchema = z.object({
  channelIds: z.array(z.uuid()).min(1),
});

export const hubspotPushBatchRowSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  contactEmail: z.string().email().nullable(),
  status: hubspotPushBatchRowStatusSchema,
  hubspotObjectId: z.string().trim().min(1).nullable(),
  errorMessage: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});

export const hubspotPushBatchSummarySchema = z.object({
  id: z.uuid(),
  status: hubspotPushBatchStatusSchema,
  totalRowCount: z.number().int().nonnegative(),
  pushedRowCount: z.number().int().nonnegative(),
  failedRowCount: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  requestedBy: hubspotPushBatchActorSchema,
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
  startedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
});

export const hubspotPushBatchDetailSchema = hubspotPushBatchSummarySchema.extend({
  scope: hubspotPushBatchScopeSchema,
  rows: z.array(hubspotPushBatchRowSchema),
});

export const listHubspotPushBatchesResponseSchema = z.object({
  items: z.array(hubspotPushBatchSummarySchema),
});

export type HubspotPushBatchStatus = z.infer<typeof hubspotPushBatchStatusSchema>;
export type HubspotPushBatchRowStatus = z.infer<typeof hubspotPushBatchRowStatusSchema>;
export type HubspotPushBatchActor = z.infer<typeof hubspotPushBatchActorSchema>;
export type CreateHubspotPushBatchRequest = z.infer<typeof createHubspotPushBatchRequestSchema>;
export type HubspotPushBatchScope = z.infer<typeof hubspotPushBatchScopeSchema>;
export type HubspotPushBatchRow = z.infer<typeof hubspotPushBatchRowSchema>;
export type HubspotPushBatchSummary = z.infer<typeof hubspotPushBatchSummarySchema>;
export type HubspotPushBatchDetail = z.infer<typeof hubspotPushBatchDetailSchema>;
export type ListHubspotPushBatchesResponse = z.infer<typeof listHubspotPushBatchesResponseSchema>;
