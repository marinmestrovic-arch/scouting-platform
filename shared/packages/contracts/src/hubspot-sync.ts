import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const hubspotObjectSyncObjectTypeSchema = z.enum([
  "clients",
  "campaigns",
  "dropdownValues",
  "owners",
  "pipelines",
  "associationDefinitions",
  "schemas",
  "collaborationHistory",
]);

export const hubspotObjectSyncModeSchema = z.enum(["incremental", "full"]);

export const hubspotObjectSyncRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const hubspotObjectSyncRunSchema = z.object({
  id: z.uuid(),
  status: hubspotObjectSyncRunStatusSchema,
  objectTypes: z.array(hubspotObjectSyncObjectTypeSchema).min(1),
  clientUpsertCount: z.number().int().nonnegative(),
  campaignUpsertCount: z.number().int().nonnegative(),
  dealMirrorUpsertCount: z.number().int().nonnegative().optional(),
  activationMirrorUpsertCount: z.number().int().nonnegative().optional(),
  deactivatedCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string()).optional(),
  mode: hubspotObjectSyncModeSchema.optional(),
  portalId: z.string().trim().min(1).nullable().optional(),
  highWaterMark: isoDatetimeSchema.nullable().optional(),
  fullReconciliation: z.boolean().optional(),
  startedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  lastError: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});

export const listHubspotObjectSyncRunsResponseSchema = z.object({
  items: z.array(hubspotObjectSyncRunSchema),
  latest: hubspotObjectSyncRunSchema.nullable(),
});

export const createHubspotObjectSyncRunResponseSchema = z.object({
  run: hubspotObjectSyncRunSchema,
});

export type HubspotObjectSyncObjectType = z.infer<typeof hubspotObjectSyncObjectTypeSchema>;
export type HubspotObjectSyncRunStatus = z.infer<typeof hubspotObjectSyncRunStatusSchema>;
export type HubspotObjectSyncMode = z.infer<typeof hubspotObjectSyncModeSchema>;
export type HubspotObjectSyncRun = z.infer<typeof hubspotObjectSyncRunSchema>;
export type ListHubspotObjectSyncRunsResponse = z.infer<
  typeof listHubspotObjectSyncRunsResponseSchema
>;
export type CreateHubspotObjectSyncRunResponse = z.infer<
  typeof createHubspotObjectSyncRunResponseSchema
>;
