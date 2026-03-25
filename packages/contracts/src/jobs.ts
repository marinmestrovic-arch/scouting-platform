import { z } from "zod";

export const JOB_NAMES = [
  "runs.discover",
  "runs.recompute",
  "channels.enrich.llm",
  "channels.enrich.hypeauditor",
  "imports.csv.process",
  "exports.csv.generate",
  "hubspot.import.batch",
  "hubspot.push.batch",
  "maintenance.refresh-stale",
] as const;

export type JobName = (typeof JOB_NAMES)[number];

const uuid = z.uuid();

export const runsDiscoverPayloadSchema = z.object({
  runRequestId: uuid,
  requestedByUserId: uuid,
});

export const runsRecomputePayloadSchema = z.object({
  runRequestId: uuid,
  requestedByUserId: uuid,
});

export const channelsEnrichLlmPayloadSchema = z.object({
  channelId: uuid,
  requestedByUserId: uuid,
});

export const channelsEnrichHypeAuditorPayloadSchema = z.object({
  advancedReportRequestId: uuid,
  requestedByUserId: uuid,
});

export const importsCsvProcessPayloadSchema = z.object({
  importBatchId: uuid,
  requestedByUserId: uuid,
});

export const exportsCsvGeneratePayloadSchema = z.object({
  exportBatchId: uuid,
  requestedByUserId: uuid,
});

export const hubspotPushBatchPayloadSchema = z.object({
  pushBatchId: uuid,
  requestedByUserId: uuid,
});

export const hubspotImportBatchPayloadSchema = z.object({
  importBatchId: uuid,
  requestedByUserId: uuid,
});

export const maintenanceRefreshStalePayloadSchema = z.object({
  initiatedBy: z.enum(["system", "admin"]),
  requestedByUserId: uuid.optional(),
});

export const jobPayloadSchemas = {
  "runs.discover": runsDiscoverPayloadSchema,
  "runs.recompute": runsRecomputePayloadSchema,
  "channels.enrich.llm": channelsEnrichLlmPayloadSchema,
  "channels.enrich.hypeauditor": channelsEnrichHypeAuditorPayloadSchema,
  "imports.csv.process": importsCsvProcessPayloadSchema,
  "exports.csv.generate": exportsCsvGeneratePayloadSchema,
  "hubspot.import.batch": hubspotImportBatchPayloadSchema,
  "hubspot.push.batch": hubspotPushBatchPayloadSchema,
  "maintenance.refresh-stale": maintenanceRefreshStalePayloadSchema,
} as const satisfies Record<JobName, z.ZodType>;

export type JobPayloadByName = {
  [Name in JobName]: z.infer<(typeof jobPayloadSchemas)[Name]>;
};

export function parseJobPayload<Name extends JobName>(
  name: Name,
  payload: unknown,
): JobPayloadByName[Name] {
  return jobPayloadSchemas[name].parse(payload) as JobPayloadByName[Name];
}
