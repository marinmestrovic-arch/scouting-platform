import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const hubspotConflictStatusSchema = z.enum(["open", "resolved", "dismissed"]);
export const hubspotFieldOwnershipSchema = z.enum(["platform", "hubspot", "shared"]);

export const hubspotConflictSchema = z.object({
  id: z.uuid(),
  portalId: z.string().trim().min(1),
  localEntityType: z.string().trim().min(1),
  localEntityId: z.string().trim().min(1),
  localEntityLabel: z.string().nullable(),
  hubspotObjectType: z.string().trim().min(1),
  hubspotObjectId: z.string().trim().min(1),
  hubspotObjectUrl: z.string().url().nullable(),
  propertyName: z.string().trim().min(1),
  localValue: z.string().nullable(),
  hubspotValue: z.string().nullable(),
  ownership: hubspotFieldOwnershipSchema,
  status: hubspotConflictStatusSchema,
  detectedAt: isoDatetimeSchema,
  resolvedAt: isoDatetimeSchema.nullable(),
  resolution: z.string().nullable(),
  resolutionAuditEventId: z.uuid().nullable(),
});

export const listHubspotConflictsResponseSchema = z.object({
  items: z.array(hubspotConflictSchema),
});

export type HubspotConflict = z.infer<typeof hubspotConflictSchema>;
export type ListHubspotConflictsResponse = z.infer<typeof listHubspotConflictsResponseSchema>;
