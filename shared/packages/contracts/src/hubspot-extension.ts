import { z } from "zod";

export const hubspotExtensionContextQuerySchema = z.object({
  portalId: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  userEmail: z.string().email(),
  appId: z.string().trim().min(1),
  objectId: z.string().trim().min(1),
  objectType: z.string().trim().min(1),
});

export const hubspotExtensionContextResponseSchema = z.object({
  creator: z
    .object({
      id: z.uuid(),
      name: z.string(),
      handle: z.string().nullable(),
      platformUrl: z.string().url().nullable(),
      followers: z.string().nullable(),
      averageViews: z.string().nullable(),
      engagementRate: z.number().nullable(),
    })
    .nullable(),
  run: z
    .object({
      id: z.uuid(),
      name: z.string(),
      campaignName: z.string().nullable(),
      assessmentSummary: z.string().nullable(),
      platformUrl: z.string().url(),
    })
    .nullable(),
  sync: z.object({
    status: z.string(),
    lastSuccessfulSyncAt: z.string().datetime().nullable(),
  }),
});

export type HubspotExtensionContextQuery = z.infer<typeof hubspotExtensionContextQuerySchema>;
export type HubspotExtensionContextResponse = z.infer<
  typeof hubspotExtensionContextResponseSchema
>;
