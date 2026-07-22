import {
  HubspotConflictStatus as PrismaHubspotConflictStatus,
  type Prisma,
} from "@prisma/client";
import type { HubspotConflict } from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";

function jsonDisplayValue(value: Prisma.JsonValue | null): string | null {
  if (value === null) {
    return null;
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value);
  }
  return JSON.stringify(value);
}

function buildHubspotObjectUrl(input: {
  portalId: string;
  objectType: string;
  objectId: string;
}): string {
  const normalizedType = input.objectType.trim().toLowerCase();
  const objectTypeId = normalizedType === "contacts" || normalizedType === "contact"
    ? "0-1"
    : normalizedType === "deals" || normalizedType === "deal"
      ? "0-3"
      : input.objectType;

  return `https://app.hubspot.com/contacts/${encodeURIComponent(input.portalId)}/record/${encodeURIComponent(objectTypeId)}/${encodeURIComponent(input.objectId)}`;
}

function toStatus(status: PrismaHubspotConflictStatus): HubspotConflict["status"] {
  return status.toLowerCase() as HubspotConflict["status"];
}

export async function listHubspotConflicts(input: {
  status?: HubspotConflict["status"] | "all";
  limit?: number;
} = {}): Promise<HubspotConflict[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const status = input.status ?? "open";
  const rows = await prisma.hubspotConflict.findMany({
    where: status === "all"
      ? {}
      : { status: status.toUpperCase() as PrismaHubspotConflictStatus },
    orderBy: [{ detectedAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      channelContactId: true,
      clientId: true,
      campaignId: true,
      runRequestId: true,
      hubspotObjectType: true,
      hubspotObjectId: true,
      propertyName: true,
      localValue: true,
      hubspotValue: true,
      ownership: true,
      status: true,
      detectedAt: true,
      resolvedAt: true,
      resolutionAction: true,
      resolutionNote: true,
      hubspotPortal: { select: { portalId: true } },
      channelContact: {
        select: {
          email: true,
          channel: { select: { title: true } },
        },
      },
      client: { select: { name: true } },
      campaign: { select: { name: true } },
      runRequest: { select: { name: true } },
    },
  });

  return rows.map((row) => {
    const localEntityType = row.channelContactId
      ? "channel_contact"
      : row.runRequestId
        ? "run_request"
        : row.campaignId
          ? "campaign"
          : row.clientId
            ? "client"
            : "integration_link";
    const localEntityId = row.channelContactId
      ?? row.runRequestId
      ?? row.campaignId
      ?? row.clientId
      ?? row.id;
    const localEntityLabel = row.channelContact
      ? `${row.channelContact.channel.title} — ${row.channelContact.email}`
      : row.runRequest?.name ?? row.campaign?.name ?? row.client?.name ?? null;

    return {
      id: row.id,
      portalId: row.hubspotPortal.portalId,
      localEntityType,
      localEntityId,
      localEntityLabel,
      hubspotObjectType: row.hubspotObjectType,
      hubspotObjectId: row.hubspotObjectId,
      hubspotObjectUrl: buildHubspotObjectUrl({
        portalId: row.hubspotPortal.portalId,
        objectType: row.hubspotObjectType,
        objectId: row.hubspotObjectId,
      }),
      propertyName: row.propertyName,
      localValue: jsonDisplayValue(row.localValue),
      hubspotValue: jsonDisplayValue(row.hubspotValue),
      ownership: row.ownership.toLowerCase() as HubspotConflict["ownership"],
      status: toStatus(row.status),
      detectedAt: row.detectedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      resolution: row.resolutionAction
        ? [row.resolutionAction, row.resolutionNote].filter(Boolean).join(": ")
        : row.resolutionNote,
      resolutionAuditEventId: null,
    };
  });
}

