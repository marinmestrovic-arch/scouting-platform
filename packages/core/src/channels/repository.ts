import {
  ChannelEnrichmentStatus as PrismaChannelEnrichmentStatus,
  ChannelManualOverrideField as PrismaChannelManualOverrideField,
  type Prisma,
} from "@prisma/client";
import type {
  ChannelEnrichmentStatus as ContractChannelEnrichmentStatus,
  ChannelManualOverrideField,
  ChannelManualOverrideOperation,
  PatchChannelManualOverridesResponse,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";

import { ServiceError } from "../errors";
import { resolveChannelEnrichmentStatus } from "../enrichment/status";

export type ListChannelsInput = {
  page: number;
  pageSize: number;
  query?: string;
};

export type ChannelSummary = {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  enrichment: ChannelEnrichmentSummary;
};

export type ChannelDetail = ChannelSummary & {
  description: string | null;
  createdAt: string;
  updatedAt: string;
  enrichment: ChannelEnrichmentDetail;
};

export type ChannelEnrichmentSummary = {
  status: ContractChannelEnrichmentStatus;
  updatedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
};

export type ChannelEnrichmentDetail = ChannelEnrichmentSummary & {
  summary: string | null;
  topics: string[] | null;
  brandFitNotes: string | null;
  confidence: number | null;
};

type MutableChannelField = "title" | "handle" | "description" | "thumbnailUrl";

type MutableChannelValues = {
  title: string;
  handle: string | null;
  description: string | null;
  thumbnailUrl: string | null;
};

type ManualOverrideFieldConfig = {
  contractField: ChannelManualOverrideField;
  prismaField: PrismaChannelManualOverrideField;
  channelField: MutableChannelField;
  nullable: boolean;
};

const channelEnrichmentListSelect = {
  status: true,
  updatedAt: true,
  completedAt: true,
  lastError: true,
} as const;

const channelEnrichmentDetailSelect = {
  ...channelEnrichmentListSelect,
  summary: true,
  topics: true,
  brandFitNotes: true,
  confidence: true,
} as const;

const channelListSelect = {
  id: true,
  youtubeChannelId: true,
  title: true,
  handle: true,
  thumbnailUrl: true,
  updatedAt: true,
  enrichment: {
    select: channelEnrichmentListSelect,
  },
} as const;

const channelDetailSelect = {
  id: true,
  youtubeChannelId: true,
  title: true,
  handle: true,
  description: true,
  thumbnailUrl: true,
  createdAt: true,
  updatedAt: true,
  enrichment: {
    select: channelEnrichmentDetailSelect,
  },
} as const;

const manualOverrideFieldConfigs: Record<ChannelManualOverrideField, ManualOverrideFieldConfig> = {
  title: {
    contractField: "title",
    prismaField: PrismaChannelManualOverrideField.TITLE,
    channelField: "title",
    nullable: false,
  },
  handle: {
    contractField: "handle",
    prismaField: PrismaChannelManualOverrideField.HANDLE,
    channelField: "handle",
    nullable: true,
  },
  description: {
    contractField: "description",
    prismaField: PrismaChannelManualOverrideField.DESCRIPTION,
    channelField: "description",
    nullable: true,
  },
  thumbnailUrl: {
    contractField: "thumbnailUrl",
    prismaField: PrismaChannelManualOverrideField.THUMBNAIL_URL,
    channelField: "thumbnailUrl",
    nullable: true,
  },
};

const manualOverrideConfigByPrismaField = new Map<PrismaChannelManualOverrideField, ManualOverrideFieldConfig>(
  Object.values(manualOverrideFieldConfigs).map((config) => [config.prismaField, config]),
);

function getManualOverrideConfigByContractField(
  field: ChannelManualOverrideField,
): ManualOverrideFieldConfig {
  return manualOverrideFieldConfigs[field];
}

function getManualOverrideConfigByPrismaField(
  field: PrismaChannelManualOverrideField,
): ManualOverrideFieldConfig {
  const config = manualOverrideConfigByPrismaField.get(field);

  if (!config) {
    throw new ServiceError("INVALID_OVERRIDE_FIELD", 500, "Invalid manual override field");
  }

  return config;
}

function getMutableChannelFieldValue(
  source: MutableChannelValues,
  field: MutableChannelField,
): string | null {
  return source[field];
}

function setMutableChannelFieldValue(
  target: Prisma.ChannelUpdateInput,
  field: MutableChannelField,
  value: string | null,
): void {
  if (field === "title") {
    if (value === null) {
      throw new ServiceError("INVALID_OVERRIDE_VALUE", 400, "Title cannot be null");
    }
    target.title = value;
    return;
  }

  if (field === "handle") {
    target.handle = value;
    return;
  }

  if (field === "description") {
    target.description = value;
    return;
  }

  target.thumbnailUrl = value;
}

function normalizeManualSetValue(
  operation: Extract<ChannelManualOverrideOperation, { op: "set" }>,
): string | null {
  const config = getManualOverrideConfigByContractField(operation.field);
  const rawValue = operation.value;

  if (rawValue === null) {
    if (!config.nullable) {
      throw new ServiceError(
        "INVALID_OVERRIDE_VALUE",
        400,
        `${operation.field} override cannot be null`,
      );
    }
    return null;
  }

  const value = rawValue.trim();

  if (!value) {
    throw new ServiceError(
      "INVALID_OVERRIDE_VALUE",
      400,
      `${operation.field} override cannot be empty`,
    );
  }

  return value;
}

function toChannelSummary(channel: {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  updatedAt: Date;
  enrichment: {
    status: PrismaChannelEnrichmentStatus;
    updatedAt: Date;
    completedAt: Date | null;
    lastError: string | null;
  } | null;
}): ChannelSummary {
  return {
    id: channel.id,
    youtubeChannelId: channel.youtubeChannelId,
    title: channel.title,
    handle: channel.handle,
    thumbnailUrl: channel.thumbnailUrl,
    enrichment: toChannelEnrichmentSummary(channel.updatedAt, channel.enrichment),
  };
}

function toChannelDetail(channel: {
  id: string;
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  enrichment: {
    status: PrismaChannelEnrichmentStatus;
    updatedAt: Date;
    completedAt: Date | null;
    lastError: string | null;
    summary: string | null;
    topics: Prisma.JsonValue | null;
    brandFitNotes: string | null;
    confidence: number | null;
  } | null;
}): ChannelDetail {
  return {
    ...toChannelSummary(channel),
    description: channel.description,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
    enrichment: toChannelEnrichmentDetail(channel.updatedAt, channel.enrichment),
  };
}

function toTopics(topics: Prisma.JsonValue | null): string[] | null {
  if (!Array.isArray(topics)) {
    return null;
  }

  const normalized: string[] = [];

  for (const topic of topics) {
    if (typeof topic !== "string") {
      return null;
    }

    const trimmed = topic.trim();

    if (trimmed) {
      normalized.push(trimmed);
    }
  }

  return normalized;
}

function toChannelEnrichmentSummary(
  channelUpdatedAt: Date,
  enrichment: {
    status: PrismaChannelEnrichmentStatus;
    updatedAt: Date;
    completedAt: Date | null;
    lastError: string | null;
  } | null,
): ChannelEnrichmentSummary {
  return {
    status: resolveChannelEnrichmentStatus({
      channelUpdatedAt,
      enrichment,
    }),
    updatedAt: enrichment?.updatedAt.toISOString() ?? null,
    completedAt: enrichment?.completedAt?.toISOString() ?? null,
    lastError: enrichment?.lastError ?? null,
  };
}

function toChannelEnrichmentDetail(
  channelUpdatedAt: Date,
  enrichment: {
    status: PrismaChannelEnrichmentStatus;
    updatedAt: Date;
    completedAt: Date | null;
    lastError: string | null;
    summary: string | null;
    topics: Prisma.JsonValue | null;
    brandFitNotes: string | null;
    confidence: number | null;
  } | null,
): ChannelEnrichmentDetail {
  const base = toChannelEnrichmentSummary(channelUpdatedAt, enrichment);

  return {
    ...base,
    summary: enrichment?.summary ?? null,
    topics: enrichment ? toTopics(enrichment.topics) : null,
    brandFitNotes: enrichment?.brandFitNotes ?? null,
    confidence: enrichment?.confidence ?? null,
  };
}

export async function listChannels(input: ListChannelsInput): Promise<{
  items: ChannelSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const skip = (input.page - 1) * input.pageSize;
  const query = input.query?.trim();
  const where: Prisma.ChannelWhereInput | undefined = query
    ? {
        OR: [
          {
            title: {
              contains: query,
              mode: "insensitive" as const,
            },
          },
          {
            handle: {
              contains: query,
              mode: "insensitive" as const,
            },
          },
          {
            youtubeChannelId: {
              contains: query,
              mode: "insensitive" as const,
            },
          },
        ],
      }
    : undefined;
  const findManyArgs = {
    skip,
    take: input.pageSize,
    orderBy: {
      createdAt: "desc",
    },
    select: channelListSelect,
    ...(where ? { where } : {}),
  } satisfies Prisma.ChannelFindManyArgs;

  const [total, channels] = await prisma.$transaction([
    prisma.channel.count(where ? { where } : undefined),
    prisma.channel.findMany(findManyArgs),
  ]);

  return {
    items: channels.map((channel) => toChannelSummary(channel)),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function getChannelById(id: string): Promise<ChannelDetail | null> {
  const channel = await prisma.channel.findUnique({
    where: { id },
    select: channelDetailSelect,
  });

  if (!channel) {
    return null;
  }

  return toChannelDetail(channel);
}

export async function getChannelByYoutubeId(youtubeChannelId: string): Promise<ChannelDetail | null> {
  const channel = await prisma.channel.findUnique({
    where: { youtubeChannelId },
    select: channelDetailSelect,
  });

  if (!channel) {
    return null;
  }

  return toChannelDetail(channel);
}

export async function upsertChannelSkeleton(input: {
  youtubeChannelId: string;
  title: string;
  handle?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
}): Promise<ChannelDetail> {
  const automatedValues: MutableChannelValues = {
    title: input.title,
    handle: input.handle ?? null,
    description: input.description ?? null,
    thumbnailUrl: input.thumbnailUrl ?? null,
  };

  return withDbTransaction(async (tx) => {
    const existing = await tx.channel.findUnique({
      where: {
        youtubeChannelId: input.youtubeChannelId,
      },
      select: {
        id: true,
        title: true,
        handle: true,
        description: true,
        thumbnailUrl: true,
        manualOverrides: {
          select: {
            id: true,
            field: true,
            value: true,
            fallbackValue: true,
          },
        },
      },
    });

    if (!existing) {
      const created = await tx.channel.create({
        data: {
          youtubeChannelId: input.youtubeChannelId,
          title: automatedValues.title,
          handle: automatedValues.handle,
          description: automatedValues.description,
          thumbnailUrl: automatedValues.thumbnailUrl,
        },
        select: channelDetailSelect,
      });

      return toChannelDetail(created);
    }

    const updateData: Prisma.ChannelUpdateInput = {
      title: automatedValues.title,
      handle: automatedValues.handle,
      description: automatedValues.description,
      thumbnailUrl: automatedValues.thumbnailUrl,
    };

    for (const manualOverride of existing.manualOverrides) {
      const config = getManualOverrideConfigByPrismaField(manualOverride.field);
      const automatedValue = getMutableChannelFieldValue(automatedValues, config.channelField);

      if (manualOverride.fallbackValue !== automatedValue) {
        await tx.channelManualOverride.update({
          where: {
            id: manualOverride.id,
          },
          data: {
            fallbackValue: automatedValue,
          },
        });
      }

      if (config.channelField === "title") {
        updateData.title = manualOverride.value ?? existing.title;
      } else {
        setMutableChannelFieldValue(updateData, config.channelField, manualOverride.value);
      }
    }

    const updated = await tx.channel.update({
      where: {
        id: existing.id,
      },
      data: updateData,
      select: channelDetailSelect,
    });

    return toChannelDetail(updated);
  });
}

export async function patchChannelManualOverrides(input: {
  channelId: string;
  actorUserId: string;
  operations: ChannelManualOverrideOperation[];
}): Promise<PatchChannelManualOverridesResponse> {
  return withDbTransaction(async (tx) => {
    const channel = await tx.channel.findUnique({
      where: {
        id: input.channelId,
      },
      select: {
        id: true,
        title: true,
        handle: true,
        description: true,
        thumbnailUrl: true,
      },
    });

    if (!channel) {
      throw new ServiceError("CHANNEL_NOT_FOUND", 404, "Channel not found");
    }

    const operationsByField = new Set<ChannelManualOverrideField>();

    for (const operation of input.operations) {
      if (operationsByField.has(operation.field)) {
        throw new ServiceError(
          "INVALID_OVERRIDE_PAYLOAD",
          400,
          "Each field can be patched at most once per request",
        );
      }
      operationsByField.add(operation.field);
    }

    const requestedPrismaFields = input.operations.map(
      (operation) => getManualOverrideConfigByContractField(operation.field).prismaField,
    );
    const existingOverrides = await tx.channelManualOverride.findMany({
      where: {
        channelId: input.channelId,
        field: {
          in: requestedPrismaFields,
        },
      },
      select: {
        id: true,
        field: true,
        value: true,
        fallbackValue: true,
      },
    });
    const existingOverridesByField = new Map(
      existingOverrides.map((manualOverride) => [manualOverride.field, manualOverride]),
    );

    const channelUpdateData: Prisma.ChannelUpdateInput = {};
    const applied: PatchChannelManualOverridesResponse["applied"] = [];

    for (const operation of input.operations) {
      const config = getManualOverrideConfigByContractField(operation.field);
      const existingManualOverride = existingOverridesByField.get(config.prismaField);

      if (operation.op === "set") {
        const value = normalizeManualSetValue(operation);
        const fallbackValue =
          existingManualOverride?.fallbackValue ??
          getMutableChannelFieldValue(channel, config.channelField);

        if (existingManualOverride) {
          await tx.channelManualOverride.update({
            where: {
              id: existingManualOverride.id,
            },
            data: {
              value,
              fallbackValue,
              updatedByUserId: input.actorUserId,
            },
          });
        } else {
          await tx.channelManualOverride.create({
            data: {
              channelId: input.channelId,
              field: config.prismaField,
              value,
              fallbackValue,
              createdByUserId: input.actorUserId,
              updatedByUserId: input.actorUserId,
            },
          });
        }

        setMutableChannelFieldValue(channelUpdateData, config.channelField, value);
      } else if (existingManualOverride) {
        await tx.channelManualOverride.delete({
          where: {
            id: existingManualOverride.id,
          },
        });

        if (config.channelField === "title") {
          channelUpdateData.title = existingManualOverride.fallbackValue ?? channel.title;
        } else {
          setMutableChannelFieldValue(
            channelUpdateData,
            config.channelField,
            existingManualOverride.fallbackValue,
          );
        }
      }

      applied.push({
        field: operation.field,
        op: operation.op,
      });
    }

    const updatedChannel =
      Object.keys(channelUpdateData).length > 0
        ? await tx.channel.update({
            where: {
              id: input.channelId,
            },
            data: channelUpdateData,
            select: channelDetailSelect,
          })
        : await tx.channel.findUniqueOrThrow({
            where: {
              id: input.channelId,
            },
            select: channelDetailSelect,
          });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "channel.manual_override.patched",
        entityType: "channel",
        entityId: input.channelId,
        metadata: {
          operations: applied,
        },
      },
    });

    return {
      channel: toChannelDetail(updatedChannel),
      applied,
    };
  });
}
