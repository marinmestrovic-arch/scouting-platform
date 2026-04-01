// @ts-nocheck
/**
 * Domain Service Pattern
 *
 * This pattern mirrors the current services in backend/packages/core.
 * Copy and adapt it for new business logic.
 *
 * Requirements enforced:
 * 1. Domain rules live in backend/packages/core
 * 2. Shared contract types enter the service at the boundary
 * 3. Multi-step writes use withDbTransaction()
 * 4. Expected failures throw ServiceError
 * 5. Privileged mutations write audit events in the same transaction
 *
 * Example location:
 * backend/packages/core/src/channels/repository.ts
 */

import { ChannelManualOverrideField as PrismaChannelManualOverrideField, Prisma } from "@prisma/client";
import type { ChannelManualOverrideField, ChannelManualOverrideOperation } from "@scouting-platform/contracts";
import { withDbTransaction } from "@scouting-platform/db";

// Adjust this import to the target folder inside backend/packages/core/src/.
import { ServiceError } from "../errors";

type MutableChannelField = "title" | "handle" | "description" | "thumbnailUrl";

type ManualOverrideFieldConfig = {
  contractField: ChannelManualOverrideField;
  prismaField: PrismaChannelManualOverrideField;
  channelField: MutableChannelField;
  nullable: boolean;
};

type AppliedOperation = {
  field: ChannelManualOverrideField;
  op: "set" | "clear";
};

const manualOverrideFieldConfigs = {
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
} as const satisfies Record<ChannelManualOverrideField, ManualOverrideFieldConfig>;

function getManualOverrideConfigByContractField(
  field: ChannelManualOverrideField,
): ManualOverrideFieldConfig {
  return manualOverrideFieldConfigs[field];
}

function getMutableChannelFieldValue(
  source: Record<MutableChannelField, string | null>,
  field: MutableChannelField,
): string | null {
  return source[field];
}

function setMutableChannelFieldValue(
  target: Prisma.ChannelUpdateInput,
  field: MutableChannelField,
  value: string | null,
): void {
  switch (field) {
    case "title":
      if (value === null) {
        throw new ServiceError("INVALID_OVERRIDE_VALUE", 400, "Title cannot be null");
      }
      target.title = value;
      return;
    case "handle":
      target.handle = value;
      return;
    case "description":
      target.description = value;
      return;
    case "thumbnailUrl":
      target.thumbnailUrl = value;
      return;
  }
}

function normalizeManualSetValue(
  operation: Extract<ChannelManualOverrideOperation, { op: "set" }>,
): string | null {
  const config = getManualOverrideConfigByContractField(operation.field);

  if (operation.value === null) {
    if (!config.nullable) {
      throw new ServiceError(
        "INVALID_OVERRIDE_VALUE",
        400,
        `${operation.field} override cannot be null`,
      );
    }

    return null;
  }

  const value = operation.value.trim();

  if (!value) {
    throw new ServiceError(
      "INVALID_OVERRIDE_VALUE",
      400,
      `${operation.field} override cannot be empty`,
    );
  }

  return value;
}

// ============================================================================
// 1. DOMAIN SERVICE
// Keep invariants, writes, and audit logging together.
// ============================================================================

export async function patchChannelManualOverrides(input: {
  channelId: string;
  actorUserId: string;
  operations: ChannelManualOverrideOperation[];
}): Promise<{ applied: AppliedOperation[] }> {
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

    const seenFields = new Set<ChannelManualOverrideField>();

    for (const operation of input.operations) {
      if (seenFields.has(operation.field)) {
        throw new ServiceError(
          "INVALID_OVERRIDE_PAYLOAD",
          400,
          "Each field can be patched at most once per request",
        );
      }

      seenFields.add(operation.field);
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
        fallbackValue: true,
      },
    });

    const existingOverridesByField = new Map(
      existingOverrides.map((manualOverride) => [manualOverride.field, manualOverride]),
    );

    const channelUpdateData: Prisma.ChannelUpdateInput = {};
    const applied: AppliedOperation[] = [];

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

        setMutableChannelFieldValue(
          channelUpdateData,
          config.channelField,
          existingManualOverride.fallbackValue,
        );
      }

      applied.push({
        field: operation.field,
        op: operation.op,
      });
    }

    if (Object.keys(channelUpdateData).length > 0) {
      await tx.channel.update({
        where: {
          id: input.channelId,
        },
        data: channelUpdateData,
      });
    }

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

    // Real services often hydrate and return a full contract DTO here.
    // This pattern keeps the focus on the invariant-protecting transaction.
    return { applied };
  });
}

// ============================================================================
// PATTERN CHECKLIST
// ============================================================================
//
// Before merging a new domain service, verify:
//
// □ Service lives in backend/packages/core
// □ Shared contract types are the input boundary
// □ Expected business failures throw ServiceError
// □ Duplicate/invalid operations are rejected before writes
// □ Multi-step writes wrapped in withDbTransaction()
// □ Privileged mutations record audit events in the same transaction
// □ Manual override flows preserve fallback values before overwriting
// □ Tests cover set, clear, duplicate field, and not-found cases
//
// ============================================================================
