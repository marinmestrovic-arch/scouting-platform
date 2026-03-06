import { z } from "zod";

const isoDatetimeSchema = z.string().datetime();

export const segmentFiltersSchema = z
  .record(z.string(), z.unknown())
  .superRefine((filters, context) => {
    if ("channelIds" in filters || "channel_ids" in filters) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Segment filters cannot include explicit channel id lists in this phase",
      });
    }
  });

export const createSegmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  filters: segmentFiltersSchema,
});

export const updateSegmentRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  filters: segmentFiltersSchema,
});

export const segmentResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  filters: segmentFiltersSchema,
  createdAt: isoDatetimeSchema,
  updatedAt: isoDatetimeSchema,
});

export const listSegmentsResponseSchema = z.object({
  items: z.array(segmentResponseSchema),
});

export type SegmentFilters = z.infer<typeof segmentFiltersSchema>;
export type CreateSegmentRequest = z.infer<typeof createSegmentRequestSchema>;
export type UpdateSegmentRequest = z.infer<typeof updateSegmentRequestSchema>;
export type SegmentResponse = z.infer<typeof segmentResponseSchema>;
export type ListSegmentsResponse = z.infer<typeof listSegmentsResponseSchema>;
