import { Role as PrismaRole, type Prisma } from "@prisma/client";
import type { HubspotExtensionContextResponse } from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";

import { ServiceError } from "../errors";

type SupportedExtensionObjectType = "contact" | "deal" | "custom";

function normalizeObjectType(value: string): SupportedExtensionObjectType {
  const normalized = value.trim().toLowerCase();

  if (["contact", "contacts", "0-1"].includes(normalized)) {
    return "contact";
  }

  if (["deal", "deals", "0-3"].includes(normalized)) {
    return "deal";
  }

  return "custom";
}

function normalizeBaseUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new ServiceError(
      "HUBSPOT_EXTENSION_ORIGIN_INVALID",
      500,
      "The Scouting Platform public URL is invalid",
    );
  }

  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new ServiceError(
      "HUBSPOT_EXTENSION_ORIGIN_INSECURE",
      500,
      "The HubSpot extension requires a configured HTTPS platform URL",
    );
  }

  return url.origin;
}

function firstString(value: Prisma.JsonValue | null): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.find((entry): entry is string => typeof entry === "string") ?? null;
}

function buildAssessmentSummary(input: {
  fitScore: number | null;
  fitReasons: Prisma.JsonValue | null;
} | null): string | null {
  if (!input) {
    return null;
  }

  const reason = firstString(input.fitReasons);
  const score = input.fitScore === null ? null : `Fit score ${Math.round(input.fitScore)}`;

  return [score, reason].filter(Boolean).join(" — ") || null;
}

function toCreator(input: {
  id: string;
  title: string;
  handle: string | null;
  metrics: {
    subscriberCount: bigint | null;
    youtubeFollowers: bigint | null;
    youtubeVideoMedianViews: bigint | null;
    youtubeEngagementRate: number | null;
  } | null;
}, baseUrl: string): NonNullable<HubspotExtensionContextResponse["creator"]> {
  return {
    id: input.id,
    name: input.title,
    handle: input.handle,
    platformUrl: `${baseUrl}/catalog/${encodeURIComponent(input.id)}`,
    followers: (input.metrics?.youtubeFollowers ?? input.metrics?.subscriberCount)?.toString() ?? null,
    averageViews: input.metrics?.youtubeVideoMedianViews?.toString() ?? null,
    engagementRate: input.metrics?.youtubeEngagementRate ?? null,
  };
}

function toRun(input: {
  id: string;
  name: string;
  campaignName: string | null;
  channelAssessments: Array<{
    fitScore: number | null;
    fitReasons: Prisma.JsonValue | null;
  }>;
}, baseUrl: string): NonNullable<HubspotExtensionContextResponse["run"]> {
  return {
    id: input.id,
    name: input.name,
    campaignName: input.campaignName,
    assessmentSummary: buildAssessmentSummary(input.channelAssessments[0] ?? null),
    platformUrl: `${baseUrl}/runs/${encodeURIComponent(input.id)}`,
  };
}

const extensionRunSelect = {
  id: true,
  name: true,
  campaignName: true,
  channelAssessments: {
    orderBy: { updatedAt: "desc" },
    take: 1,
    select: {
      fitScore: true,
      fitReasons: true,
    },
  },
} as const;

const extensionChannelSelect = {
  id: true,
  title: true,
  handle: true,
  metrics: {
    select: {
      subscriberCount: true,
      youtubeFollowers: true,
      youtubeVideoMedianViews: true,
      youtubeEngagementRate: true,
    },
  },
} as const;

export async function getHubspotExtensionContext(input: {
  portalId: string;
  userEmail: string;
  objectId: string;
  objectType: string;
  platformBaseUrl: string;
}): Promise<HubspotExtensionContextResponse> {
  const baseUrl = normalizeBaseUrl(input.platformBaseUrl);
  const portalId = input.portalId.trim();
  const objectId = input.objectId.trim();

  const [portal, user] = await Promise.all([
    prisma.hubspotPortal.findUnique({
      where: { portalId },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: {
        email: { equals: input.userEmail.trim(), mode: "insensitive" },
        isActive: true,
      },
      select: { id: true, role: true },
    }),
  ]);

  if (!portal || !user) {
    throw new ServiceError(
      "HUBSPOT_EXTENSION_FORBIDDEN",
      403,
      "This HubSpot account or user is not authorized for Scouting Platform data",
    );
  }

  const objectType = normalizeObjectType(input.objectType);
  const canReadEveryRun = user.role === PrismaRole.ADMIN;

  if (objectType === "contact") {
    const link = await prisma.hubspotContactLink.findUnique({
      where: {
        hubspotPortalId_hubspotObjectId: {
          hubspotPortalId: portal.id,
          hubspotObjectId: objectId,
        },
      },
      select: {
        lastSuccessfulSyncAt: true,
        channelContact: {
          select: {
            id: true,
            channel: { select: extensionChannelSelect },
          },
        },
      },
    });

    if (!link) {
      return {
        creator: null,
        run: null,
        sync: { status: "not_linked", lastSuccessfulSyncAt: null },
      };
    }

    const latestRow = await prisma.hubspotImportBatchRow.findFirst({
      where: {
        channelContactId: link.channelContact.id,
        batch: {
          hubspotPortalId: portal.id,
          ...(canReadEveryRun
            ? {}
            : { runRequest: { requestedByUserId: user.id } }),
        },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        batch: {
          select: {
            status: true,
            runRequest: { select: extensionRunSelect },
          },
        },
      },
    });

    return {
      creator: toCreator(link.channelContact.channel, baseUrl),
      run: latestRow ? toRun(latestRow.batch.runRequest, baseUrl) : null,
      sync: {
        status: latestRow?.batch.status.toLowerCase() ?? "linked",
        lastSuccessfulSyncAt: link.lastSuccessfulSyncAt?.toISOString() ?? null,
      },
    };
  }

  if (objectType === "deal") {
    const link = await prisma.hubspotDealLink.findFirst({
      where: {
        hubspotPortalId: portal.id,
        hubspotObjectId: objectId,
        ...(canReadEveryRun
          ? {}
          : { runRequest: { requestedByUserId: user.id } }),
      },
      select: {
        lastSuccessfulSyncAt: true,
        runRequest: { select: extensionRunSelect },
      },
    });

    return link
      ? {
          creator: null,
          run: toRun(link.runRequest, baseUrl),
          sync: {
            status: "linked",
            lastSuccessfulSyncAt: link.lastSuccessfulSyncAt?.toISOString() ?? null,
          },
        }
      : {
          creator: null,
          run: null,
          sync: { status: "not_linked", lastSuccessfulSyncAt: null },
        };
  }

  const campaign = await prisma.campaign.findFirst({
    where: {
      hubspotPortalId: portal.id,
      hubspotObjectId: objectId,
      hubspotObjectType: input.objectType,
    },
    select: {
      hubspotSyncedAt: true,
      runRequests: {
        where: canReadEveryRun ? {} : { requestedByUserId: user.id },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: extensionRunSelect,
      },
    },
  });
  const run = campaign?.runRequests[0] ?? null;

  return {
    creator: null,
    run: run ? toRun(run, baseUrl) : null,
    sync: {
      status: campaign ? "linked" : "not_linked",
      lastSuccessfulSyncAt: campaign?.hubspotSyncedAt?.toISOString() ?? null,
    },
  };
}
