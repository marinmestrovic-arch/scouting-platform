import { z } from "zod";

const uuid = z.uuid();
const isoDatetime = z.string().datetime();

export const runChannelAssessmentStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export type RunChannelAssessmentStatus = z.infer<typeof runChannelAssessmentStatusSchema>;

export const runChannelAssessmentItemSchema = z.object({
  id: uuid,
  runRequestId: uuid,
  channelId: uuid,
  status: runChannelAssessmentStatusSchema,
  model: z.string().nullable(),
  fitScore: z.number().min(0).max(1).nullable(),
  fitReasons: z.array(z.string()).nullable(),
  fitConcerns: z.array(z.string()).nullable(),
  recommendedAngles: z.array(z.string()).nullable(),
  avoidTopics: z.array(z.string()).nullable(),
  assessedAt: isoDatetime.nullable(),
  lastError: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export type RunChannelAssessmentItem = z.infer<typeof runChannelAssessmentItemSchema>;

export const triggerRunAssessmentResponseSchema = z.object({
  runId: uuid,
  enqueued: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  assessments: z.array(runChannelAssessmentItemSchema),
});

export type TriggerRunAssessmentResponse = z.infer<typeof triggerRunAssessmentResponseSchema>;
