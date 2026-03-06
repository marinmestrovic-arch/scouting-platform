import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const listChannelsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(200).optional(),
});

export const channelSummarySchema = z.object({
  id: z.uuid(),
  youtubeChannelId: z.string(),
  title: z.string(),
  handle: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
});

export const channelDetailSchema = channelSummarySchema.extend({
  description: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});

export const listChannelsResponseSchema = z.object({
  items: z.array(channelSummarySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
});

export type ListChannelsQuery = z.infer<typeof listChannelsQuerySchema>;
export type ChannelSummary = z.infer<typeof channelSummarySchema>;
export type ChannelDetail = z.infer<typeof channelDetailSchema>;
export type ListChannelsResponse = z.infer<typeof listChannelsResponseSchema>;
