import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const runRequestStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export const runResultSourceSchema = z.enum(["catalog", "discovery"]);

export const createRunRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  query: z.string().trim().min(1).max(500),
  target: z.number().int().positive(),
});

export const createRunResponseSchema = z.object({
  runId: z.uuid(),
  status: runRequestStatusSchema,
});

export const recentRunItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  query: z.string(),
  target: z.number().int().positive().nullable(),
  status: runRequestStatusSchema,
  lastError: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
  startedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  resultCount: z.number().int().nonnegative(),
});

export const listRecentRunsResponseSchema = z.object({
  items: z.array(recentRunItemSchema),
});

export const runResultChannelSchema = z.object({
  id: z.uuid(),
  youtubeChannelId: z.string(),
  title: z.string(),
  handle: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
});

export const runResultItemSchema = z.object({
  id: z.uuid(),
  channelId: z.uuid(),
  rank: z.number().int().min(1),
  source: runResultSourceSchema,
  createdAt: isoDatetimeSchema,
  channel: runResultChannelSchema,
});

export const runStatusResponseSchema = z.object({
  id: z.uuid(),
  requestedByUserId: z.uuid(),
  name: z.string(),
  query: z.string(),
  target: z.number().int().positive().nullable(),
  status: runRequestStatusSchema,
  lastError: z.string().nullable(),
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
  startedAt: isoDatetimeSchema.nullable(),
  completedAt: isoDatetimeSchema.nullable(),
  results: z.array(runResultItemSchema),
});

export type RunRequestStatus = z.infer<typeof runRequestStatusSchema>;
export type RunResultSource = z.infer<typeof runResultSourceSchema>;
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;
export type RecentRunItem = z.infer<typeof recentRunItemSchema>;
export type ListRecentRunsResponse = z.infer<typeof listRecentRunsResponseSchema>;
export type RunResultChannel = z.infer<typeof runResultChannelSchema>;
export type RunResultItem = z.infer<typeof runResultItemSchema>;
export type RunStatusResponse = z.infer<typeof runStatusResponseSchema>;
