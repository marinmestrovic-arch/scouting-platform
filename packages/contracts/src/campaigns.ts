import { z } from "zod";

import { roleSchema, userTypeSchema } from "./auth";
import { runMonthSchema } from "./runs";

const isoDatetimeSchema = z.string().datetime();

export const campaignClientSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  domain: z.string().nullable().optional(),
  countryRegion: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
});

export const campaignMarketSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
});

export const campaignSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  client: campaignClientSchema,
  market: campaignMarketSchema,
  briefLink: z.string().nullable(),
  month: runMonthSchema,
  year: z.number().int().min(2000).max(2100),
  isActive: z.boolean(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});

export const createCampaignRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  clientId: z.uuid(),
  marketId: z.uuid(),
  briefLink: z.string().trim().url().max(2048).optional(),
  month: runMonthSchema,
  year: z.number().int().min(2000).max(2100),
  isActive: z.boolean().default(true),
});

export const listCampaignsQuerySchema = z.object({
  clientId: z.uuid().optional(),
  marketId: z.uuid().optional(),
  active: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => (typeof value === "boolean" ? value : value === "true"))
    .optional(),
});

export const listCampaignsResponseSchema = z.object({
  items: z.array(campaignSummarySchema),
  filterOptions: z.object({
    clients: z.array(campaignClientSchema),
    markets: z.array(campaignMarketSchema),
  }),
  permissions: z.object({
    canCreate: z.boolean(),
    role: roleSchema,
    userType: userTypeSchema,
  }),
});

export const clientSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  domain: z.string().nullable(),
  countryRegion: z.string().nullable(),
  city: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});

export const createClientRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(255).optional(),
  countryRegion: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(200),
});

export const listClientsResponseSchema = z.object({
  items: z.array(clientSummarySchema),
  permissions: z.object({
    canCreate: z.boolean(),
    role: roleSchema,
    userType: userTypeSchema,
  }),
});

export type CampaignClient = z.infer<typeof campaignClientSchema>;
export type CampaignMarket = z.infer<typeof campaignMarketSchema>;
export type CampaignSummary = z.infer<typeof campaignSummarySchema>;
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;
export type ListCampaignsResponse = z.infer<typeof listCampaignsResponseSchema>;
export type ClientSummary = z.infer<typeof clientSummarySchema>;
export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;
export type ListClientsResponse = z.infer<typeof listClientsResponseSchema>;
