import { Role, RunMonth, UserType, type Prisma } from "@prisma/client";
import type {
  CampaignSummary,
  ClientSummary,
  CreateCampaignRequest,
  CreateClientRequest,
  ListCampaignsQuery,
  ListCampaignsResponse,
} from "@scouting-platform/contracts";
import {
  COUNTRY_REGION_OPTIONS as countryRegionOptions,
  createCampaignRequestSchema,
  createClientRequestSchema,
  listCampaignsQuerySchema,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";

import { fromPrismaRole, fromPrismaUserType } from "./auth/roles";
import { ServiceError } from "./errors";

const campaignSelect = {
  id: true,
  name: true,
  briefLink: true,
  month: true,
  year: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  client: {
    select: {
      id: true,
      name: true,
      domain: true,
      countryRegion: true,
      city: true,
    },
  },
  market: {
    select: {
      id: true,
      name: true,
    },
  },
} as const;

function toRunMonthValue(value: string): CampaignSummary["month"] {
  return value.toLowerCase() as CampaignSummary["month"];
}

function toClientSummary(
  client: {
    id: string;
    name: string;
    domain: string | null;
    countryRegion: string | null;
    city: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
): ClientSummary {
  return {
    id: client.id,
    name: client.name,
    domain: client.domain,
    countryRegion: client.countryRegion,
    city: client.city,
    createdAt: client.createdAt.toISOString(),
    updatedAt: client.updatedAt.toISOString(),
  };
}

function toCampaignSummary(
  campaign: Prisma.CampaignGetPayload<{ select: typeof campaignSelect }>,
): CampaignSummary {
  return {
    id: campaign.id,
    name: campaign.name,
    client: campaign.client,
    market: campaign.market,
    briefLink: campaign.briefLink,
    month: toRunMonthValue(campaign.month),
    year: campaign.year,
    isActive: campaign.isActive,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  };
}

async function getRequestUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      userType: true,
    },
  });

  if (!user) {
    throw new ServiceError("USER_NOT_FOUND", 404, "User not found");
  }

  return user;
}

function canCreateCampaign(user: { role: Role; userType: UserType }): boolean {
  return (
    user.role === Role.ADMIN ||
    user.userType === UserType.CAMPAIGN_LEAD ||
    user.userType === UserType.HOC
  );
}

async function ensureMarketReferenceData() {
  await prisma.market.createMany({
    data: countryRegionOptions.map((name) => ({ name })),
    skipDuplicates: true,
  });
}

export async function listCampaigns(input: {
  userId: string;
  query?: Partial<ListCampaignsQuery>;
}): Promise<ListCampaignsResponse> {
  const parsedQuery = listCampaignsQuerySchema.partial().parse(input.query ?? {});
  const requestUser = await getRequestUser(input.userId);
  await ensureMarketReferenceData();

  const where: Prisma.CampaignWhereInput = {
    ...(parsedQuery.clientId ? { clientId: parsedQuery.clientId } : {}),
    ...(parsedQuery.marketId ? { marketId: parsedQuery.marketId } : {}),
    ...(typeof parsedQuery.active === "boolean" ? { isActive: parsedQuery.active } : {}),
  };

  const [campaigns, clients, markets] = await Promise.all([
    prisma.campaign.findMany({
      where,
      select: campaignSelect,
      orderBy: [{ isActive: "desc" }, { year: "desc" }, { createdAt: "desc" }],
    }),
    prisma.client.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.market.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    items: campaigns.map(toCampaignSummary),
    filterOptions: {
      clients,
      markets,
    },
    permissions: {
      canCreate: canCreateCampaign(requestUser),
      role: fromPrismaRole(requestUser.role),
      userType: fromPrismaUserType(requestUser.userType),
    },
  };
}

export async function createCampaign(input: CreateCampaignRequest & { userId: string }): Promise<CampaignSummary> {
  const requestUser = await getRequestUser(input.userId);

  if (!canCreateCampaign(requestUser)) {
    throw new ServiceError("CAMPAIGN_CREATE_FORBIDDEN", 403, "Forbidden");
  }

  const payload = createCampaignRequestSchema.parse(input);
  await ensureMarketReferenceData();

  const [client, market] = await Promise.all([
    prisma.client.findUnique({ where: { id: payload.clientId }, select: { id: true } }),
    prisma.market.findUnique({ where: { id: payload.marketId }, select: { id: true } }),
  ]);

  if (!client || !market) {
    throw new ServiceError("CAMPAIGN_REFERENCE_INVALID", 400, "Client or market not found");
  }

  const created = await withDbTransaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        name: payload.name.trim(),
        clientId: payload.clientId,
        marketId: payload.marketId,
        briefLink: payload.briefLink?.trim() || null,
        month: payload.month.toUpperCase() as RunMonth,
        year: payload.year,
        isActive: payload.isActive,
        createdByUserId: input.userId,
      },
      select: campaignSelect,
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.userId,
        action: "campaign.created",
        entityType: "campaign",
        entityId: campaign.id,
        metadata: {
          campaignName: campaign.name,
          clientId: campaign.client.id,
          marketId: campaign.market.id,
        },
      },
    });

    return campaign;
  });

  return toCampaignSummary(created);
}

export async function listClients(input: { userId: string }) {
  const requestUser = await getRequestUser(input.userId);
  const clients = await prisma.client.findMany({
    orderBy: {
      name: "asc",
    },
  });

  return {
    items: clients.map(toClientSummary),
    permissions: {
      canCreate: canCreateCampaign(requestUser),
      role: fromPrismaRole(requestUser.role),
      userType: fromPrismaUserType(requestUser.userType),
    },
  };
}

export async function createClient(input: CreateClientRequest & { userId: string }): Promise<ClientSummary> {
  const requestUser = await getRequestUser(input.userId);

  if (!canCreateCampaign(requestUser)) {
    throw new ServiceError("CLIENT_CREATE_FORBIDDEN", 403, "Forbidden");
  }

  const payload = createClientRequestSchema.parse(input);

  const created = await withDbTransaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        name: payload.name.trim(),
        domain: payload.domain?.trim() || null,
        countryRegion: payload.countryRegion.trim(),
        city: payload.city.trim(),
      },
    });

    await tx.auditEvent.create({
      data: {
        actorUserId: input.userId,
        action: "client.created",
        entityType: "client",
        entityId: client.id,
        metadata: {
          clientName: client.name,
        },
      },
    });

    return client;
  });

  return toClientSummary(created);
}
