import { z } from "zod";

const providerIdSchema = z.union([z.string(), z.number()]).transform(String);

export const hubspotWebhookEventPayloadSchema = z
  .object({
    eventId: providerIdSchema.optional(),
    subscriptionId: providerIdSchema,
    portalId: providerIdSchema,
    appId: providerIdSchema.optional(),
    occurredAt: z.number().int().nonnegative(),
    subscriptionType: z.string().trim().min(1),
    attemptNumber: z.number().int().nonnegative().optional(),
    objectTypeId: providerIdSchema.optional(),
    objectId: providerIdSchema.optional(),
    propertyName: z.string().optional(),
    propertyValue: z.unknown().optional(),
    changeSource: z.string().optional(),
    primaryObjectId: providerIdSchema.optional(),
    mergedObjectIds: z.array(providerIdSchema).optional(),
    newObjectId: providerIdSchema.optional(),
  })
  .passthrough();

export const hubspotWebhookDeliverySchema = z.array(hubspotWebhookEventPayloadSchema).min(1).max(100);

export const hubspotWebhookAcceptedResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
});

export type HubspotWebhookEventPayload = z.infer<typeof hubspotWebhookEventPayloadSchema>;
export type HubspotWebhookAcceptedResponse = z.infer<typeof hubspotWebhookAcceptedResponseSchema>;
