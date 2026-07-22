import { Prisma } from "@prisma/client";
import type { ChannelCollaboration } from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";

export type ChannelCollaborationHistory = Readonly<{
  workedWith: boolean | null;
  collaborations: ChannelCollaboration[];
}>;

function readWorkedWith(value: Prisma.JsonValue | null): boolean | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const rawValue = value.worked_with;
  if (rawValue === true || rawValue === "true") {
    return true;
  }
  if (rawValue === false || rawValue === "false") {
    return false;
  }
  return null;
}

function toUrlOrNull(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildHubspotDealUrl(portalId: string, dealId: string): string {
  return `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}/record/0-3/${encodeURIComponent(dealId)}`;
}

export async function getChannelCollaborationHistory(
  channelId: string,
): Promise<ChannelCollaborationHistory> {
  const [contactLinks, dealMirrors] = await Promise.all([
    prisma.hubspotContactLink.findMany({
      where: {
        archived: false,
        channelContact: { channelId },
      },
      select: { mirrorProperties: true },
    }),
    prisma.hubspotDealMirror.findMany({
      where: {
        archived: false,
        contactAssociations: {
          some: {
            hubspotContactLink: {
              archived: false,
              channelContact: { channelId },
            },
          },
        },
      },
      orderBy: [{ closeDate: "desc" }, { hubspotCreatedAt: "desc" }, { id: "asc" }],
      include: {
        hubspotPortal: { select: { portalId: true } },
        clientAssociations: {
          orderBy: { client: { name: "asc" } },
          select: { client: { select: { name: true } } },
        },
        campaignAssociations: {
          orderBy: { campaign: { name: "asc" } },
          select: { campaign: { select: { name: true } } },
        },
        activationAssociations: {
          where: { hubspotActivationMirror: { archived: false } },
          orderBy: { hubspotActivationMirror: { publicationDate: "desc" } },
          select: {
            hubspotActivationMirror: {
              select: {
                hubspotObjectId: true,
                name: true,
                activationType: true,
                activationUrl: true,
                publicationDate: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const ownerKeys = dealMirrors.flatMap((deal) =>
    deal.ownerId ? [{ hubspotPortalId: deal.hubspotPortalId, hubspotOwnerId: deal.ownerId }] : [],
  );
  const pipelineIds = [...new Set(dealMirrors.flatMap((deal) => deal.pipelineId ? [deal.pipelineId] : []))];
  const [owners, pipelines] = await Promise.all([
    ownerKeys.length > 0
      ? prisma.hubspotOwner.findMany({
          where: { OR: ownerKeys },
          select: { hubspotPortalId: true, hubspotOwnerId: true, displayName: true, email: true },
        })
      : [],
    pipelineIds.length > 0
      ? prisma.hubspotPipeline.findMany({
          where: {
            objectType: "deals",
            hubspotPipelineId: { in: pipelineIds },
          },
          select: {
            hubspotPortalId: true,
            hubspotPipelineId: true,
            stages: {
              select: { hubspotStageId: true, label: true },
            },
          },
        })
      : [],
  ]);
  const ownersByKey = new Map(owners.map((owner) => [
    `${owner.hubspotPortalId}:${owner.hubspotOwnerId}`,
    owner.displayName ?? owner.email,
  ]));
  const stagesByKey = new Map(pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => [
      `${pipeline.hubspotPortalId}:${pipeline.hubspotPipelineId}:${stage.hubspotStageId}`,
      stage.label,
    ] as const),
  ));
  const workedWithValues = contactLinks.map((link) => readWorkedWith(link.mirrorProperties));
  const workedWith = workedWithValues.includes(true)
    ? true
    : workedWithValues.includes(false)
      ? false
      : null;

  return {
    workedWith,
    collaborations: dealMirrors.map((deal) => ({
      hubspotDealId: deal.hubspotObjectId,
      dealName: deal.dealName,
      hubspotDealUrl: buildHubspotDealUrl(
        deal.hubspotPortal.portalId,
        deal.hubspotObjectId,
      ),
      clients: deal.clientAssociations.map((association) => association.client.name),
      campaigns: deal.campaignAssociations.map((association) => association.campaign.name),
      amount: deal.amount,
      currencyCode: deal.currencyCode,
      stage: deal.pipelineId && deal.stageId
        ? stagesByKey.get(`${deal.hubspotPortalId}:${deal.pipelineId}:${deal.stageId}`) ?? deal.stageId
        : deal.stageId,
      owner: deal.ownerId
        ? ownersByKey.get(`${deal.hubspotPortalId}:${deal.ownerId}`) ?? null
        : null,
      closeDate: deal.closeDate?.toISOString() ?? null,
      createdAt: deal.hubspotCreatedAt?.toISOString() ?? null,
      activations: deal.activationAssociations.map(({ hubspotActivationMirror: activation }) => ({
        id: activation.hubspotObjectId,
        name: activation.name,
        type: activation.activationType,
        url: toUrlOrNull(activation.activationUrl),
        publicationDate: activation.publicationDate?.toISOString() ?? null,
      })),
    })),
  };
}
