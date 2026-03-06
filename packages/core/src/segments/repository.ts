import type { Prisma } from "@prisma/client";
import {
  segmentFiltersSchema,
  type SegmentFilters,
  type SegmentResponse,
} from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";

import { ServiceError } from "../errors";

type SavedSegmentRecord = {
  id: string;
  name: string;
  filters: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

function parseFilters(filters: Prisma.JsonValue): SegmentFilters {
  const parsed = segmentFiltersSchema.safeParse(filters);

  if (!parsed.success) {
    throw new ServiceError(
      "SEGMENT_FILTERS_INVALID",
      500,
      "Saved segment contains invalid filters",
    );
  }

  return parsed.data;
}

function toSegmentResponse(segment: SavedSegmentRecord): SegmentResponse {
  return {
    id: segment.id,
    name: segment.name,
    filters: parseFilters(segment.filters),
    createdAt: segment.createdAt.toISOString(),
    updatedAt: segment.updatedAt.toISOString(),
  };
}

function toJsonObject(filters: SegmentFilters): Prisma.InputJsonObject {
  return filters as Prisma.InputJsonObject;
}

export async function listUserSegments(userId: string): Promise<SegmentResponse[]> {
  const segments = await prisma.savedSegment.findMany({
    where: {
      userId,
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
      name: true,
      filters: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return segments.map((segment) => toSegmentResponse(segment));
}

export async function createUserSegment(input: {
  userId: string;
  name: string;
  filters: SegmentFilters;
}): Promise<SegmentResponse> {
  const segment = await prisma.savedSegment.create({
    data: {
      userId: input.userId,
      name: input.name.trim(),
      filters: toJsonObject(input.filters),
    },
    select: {
      id: true,
      name: true,
      filters: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return toSegmentResponse(segment);
}

export async function updateUserSegment(input: {
  userId: string;
  segmentId: string;
  name: string;
  filters: SegmentFilters;
}): Promise<SegmentResponse> {
  const existing = await prisma.savedSegment.findFirst({
    where: {
      id: input.segmentId,
      userId: input.userId,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    throw new ServiceError("SEGMENT_NOT_FOUND", 404, "Segment not found");
  }

  const segment = await prisma.savedSegment.update({
    where: {
      id: existing.id,
    },
    data: {
      name: input.name.trim(),
      filters: toJsonObject(input.filters),
    },
    select: {
      id: true,
      name: true,
      filters: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return toSegmentResponse(segment);
}

export async function deleteUserSegment(input: {
  userId: string;
  segmentId: string;
}): Promise<void> {
  const result = await prisma.savedSegment.deleteMany({
    where: {
      id: input.segmentId,
      userId: input.userId,
    },
  });

  if (result.count === 0) {
    throw new ServiceError("SEGMENT_NOT_FOUND", 404, "Segment not found");
  }
}
