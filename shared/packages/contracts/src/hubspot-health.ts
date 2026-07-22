import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const hubspotHealthStatusSchema = z.enum([
  "unknown",
  "healthy",
  "degraded",
  "unhealthy",
]);

export const hubspotHealthCheckStatusSchema = z.enum([
  "pass",
  "warning",
  "fail",
  "skipped",
]);

export const hubspotHealthCheckSchema = z.object({
  code: z.string().trim().min(1),
  label: z.string().trim().min(1),
  status: hubspotHealthCheckStatusSchema,
  message: z.string().trim().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const hubspotHealthReportSchema = z.object({
  status: hubspotHealthStatusSchema,
  portalId: z.string().trim().min(1).nullable(),
  displayName: z.string().nullable(),
  directSyncEnabled: z.boolean(),
  webhooksEnabled: z.boolean(),
  checkedAt: isoDatetimeSchema.nullable(),
  lastReferenceSyncAt: isoDatetimeSchema.nullable(),
  lastObjectSyncAt: isoDatetimeSchema.nullable(),
  lastWebhookProcessedAt: isoDatetimeSchema.nullable(),
  checks: z.array(hubspotHealthCheckSchema),
  blockers: z.array(z.string()),
  requiredActions: z.array(z.string()),
  lastError: z.string().nullable(),
});

export const hubspotHealthCheckRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const hubspotHealthCheckRunSchema = z.object({
  id: z.uuid(),
  status: hubspotHealthCheckRunStatusSchema,
  queuedAt: isoDatetimeSchema,
  startedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  lastError: z.string().nullable(),
});

export const hubspotHealthStateSchema = hubspotHealthReportSchema.extend({
  latestRun: hubspotHealthCheckRunSchema.nullable(),
});

export const hubspotReadinessSchema = z.object({
  enabled: z.boolean(),
  ready: z.boolean(),
  healthStatus: hubspotHealthStatusSchema,
  portalId: z.string().trim().min(1).nullable(),
  blockers: z.array(z.string()),
  activeBatchId: z.uuid().nullable(),
});

export type HubspotHealthStatus = z.infer<typeof hubspotHealthStatusSchema>;
export type HubspotHealthCheck = z.infer<typeof hubspotHealthCheckSchema>;
export type HubspotHealthReport = z.infer<typeof hubspotHealthReportSchema>;
export type HubspotHealthCheckRunStatus = z.infer<
  typeof hubspotHealthCheckRunStatusSchema
>;
export type HubspotHealthCheckRun = z.infer<typeof hubspotHealthCheckRunSchema>;
export type HubspotHealthState = z.infer<typeof hubspotHealthStateSchema>;
export type HubspotReadiness = z.infer<typeof hubspotReadinessSchema>;
