import {
  HubspotObjectSyncRunStatus as PrismaHubspotObjectSyncRunStatus,
  Prisma,
  type PrismaClient,
  Role,
  RunMonth,
} from "@prisma/client";
import type {
  HubspotObjectSyncObjectType,
  HubspotObjectSyncRun,
  ListHubspotObjectSyncRunsResponse,
} from "@scouting-platform/contracts";
import { hubspotObjectSyncObjectTypeSchema } from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  fetchHubspotAssociations,
  fetchHubspotCustomObjects,
  type HubspotCustomObjectRecord,
} from "@scouting-platform/integrations";

import { recordAuditEvent } from "../audit";
import { syncHubspotDropdownValues } from "../dropdown-values";
import { ServiceError } from "../errors";
import { enqueueHubspotObjectSyncJob } from "./queue";

const OBJECT_TYPES: HubspotObjectSyncObjectType[] = [
  "clients",
  "campaigns",
  "dropdownValues",
];

const syncRunSelect = {
  id: true,
  status: true,
  objectTypes: true,
  clientUpsertCount: true,
  campaignUpsertCount: true,
  deactivatedCount: true,
  startedAt: true,
  completedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} as const;

type SyncRunRecord = Prisma.HubspotObjectSyncRunGetPayload<{
  select: typeof syncRunSelect;
}>;
type HubspotObjectSyncRunDelegate = PrismaClient["hubspotObjectSyncRun"];
type HubspotObjectSyncRunAccessor = {
  hubspotObjectSyncRun?: HubspotObjectSyncRunDelegate;
};

type HubspotObjectSyncConfig = Readonly<{
  client: Readonly<{
    objectType: string;
    nameProperty: string;
    domainProperty: string | null;
    countryRegionProperty: string | null;
    cityProperty: string | null;
    activeProperty: string | null;
  }>;
  campaign: Readonly<{
    objectType: string;
    nameProperty: string;
    clientObjectIdProperty: string | null;
    clientAssociationTypeId: number | null;
    marketProperty: string | null;
    briefLinkProperty: string | null;
    monthProperty: string | null;
    yearProperty: string | null;
    activeProperty: string | null;
  }>;
}>;

type SyncCounts = Readonly<{
  clientUpsertCount: number;
  campaignUpsertCount: number;
  deactivatedCount: number;
  lastError: string | null;
}>;

type SyncedClient = Readonly<{
  id: string;
  hubspotObjectId: string;
}>;

type SyncClientsResult = Readonly<{
  syncedClients: SyncedClient[];
  upsertCount: number;
  deactivatedCount: number;
  activeHubspotObjectIds: string[];
}>;

type SyncCampaignsResult = Readonly<{
  upsertCount: number;
  deactivatedCount: number;
  lastError: string | null;
  activeHubspotObjectIds: string[];
}>;

type CampaignClientResolution = Readonly<{
  campaignObjectId: string;
  clientObjectId: string | null;
}>;

type SkippedHubspotRecord = Readonly<{
  objectId: string;
  reason: string;
}>;

type CampaignSyncData = Readonly<{
  name: string;
  clientId: string | null;
  marketId: string | null;
  briefLink: string | null;
  month: RunMonth | null;
  year: number | null;
  isActive: boolean;
  hubspotObjectId: string;
  hubspotObjectType: string;
  hubspotArchived: boolean;
  hubspotSyncedAt: Date;
  hubspotRawPayload: Prisma.InputJsonValue;
}>;

function hubspotObjectIdRetentionFilter(
  activeHubspotObjectIds: string[],
): Prisma.StringNullableFilter {
  return {
    not: null,
    ...(activeHubspotObjectIds.length > 0 ? { notIn: activeHubspotObjectIds } : {}),
  };
}

function getHubspotObjectSyncRunDelegate(
  client: HubspotObjectSyncRunAccessor = prisma as unknown as HubspotObjectSyncRunAccessor,
): HubspotObjectSyncRunDelegate {
  const delegate = client.hubspotObjectSyncRun;

  if (!delegate) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_MODEL_UNAVAILABLE",
      503,
      "HubSpot object sync database model is unavailable. Run Prisma generate and migrations, then restart the app.",
    );
  }

  return delegate;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function formatSkippedHubspotRecords(records: SkippedHubspotRecord[]): string | null {
  if (records.length === 0) {
    return null;
  }

  const examples = records
    .slice(0, 5)
    .map((record) => `${record.objectId}: ${record.reason}`)
    .join("; ");
  const remainder = records.length > 5 ? `; ${records.length - 5} more` : "";
  const noun = records.length === 1 ? "campaign object" : "campaign objects";

  return `Skipped ${records.length} HubSpot ${noun} because required local Campaign fields were missing or invalid. ${examples}${remainder}`;
}

function isSkippableCampaignRecordError(error: unknown): boolean {
  if (!(error instanceof ServiceError)) {
    return false;
  }

  return [
    "HUBSPOT_OBJECT_SYNC_ACTIVE_FLAG_INVALID",
    "HUBSPOT_OBJECT_SYNC_CAMPAIGN_CLIENT_AMBIGUOUS",
    "HUBSPOT_OBJECT_SYNC_CAMPAIGN_CLIENT_NOT_FOUND",
    "HUBSPOT_OBJECT_SYNC_CAMPAIGN_SCHEMA_INCOMPATIBLE",
    "HUBSPOT_OBJECT_SYNC_MONTH_INVALID",
    "HUBSPOT_OBJECT_SYNC_PROPERTY_MISSING",
    "HUBSPOT_OBJECT_SYNC_YEAR_INVALID",
  ].includes(error.code);
}

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function hasLegacyRequiredCampaignNulls(data: CampaignSyncData): boolean {
  return data.clientId === null || data.marketId === null || data.month === null || data.year === null;
}

function toLegacyCompatibleCampaignUpdateData(data: CampaignSyncData): Prisma.CampaignUncheckedUpdateInput {
  return {
    name: data.name,
    ...(data.clientId === null ? {} : { clientId: data.clientId }),
    ...(data.marketId === null ? {} : { marketId: data.marketId }),
    briefLink: data.briefLink,
    ...(data.month === null ? {} : { month: data.month }),
    ...(data.year === null ? {} : { year: data.year }),
    isActive: data.isActive,
    hubspotObjectId: data.hubspotObjectId,
    hubspotObjectType: data.hubspotObjectType,
    hubspotArchived: data.hubspotArchived,
    hubspotSyncedAt: data.hubspotSyncedAt,
    hubspotRawPayload: data.hubspotRawPayload,
  };
}

function isCampaignNullConstraintError(error: unknown, data: CampaignSyncData): boolean {
  return hasPrismaErrorCode(error, "P2011") && hasLegacyRequiredCampaignNulls(data);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_CONFIG_MISSING",
      500,
      `${name} is required for HubSpot Client/Campaign custom object sync`,
    );
  }

  return value;
}

function getOptionalEnv(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();

  return value ? value : null;
}

function getOptionalPositiveIntEnv(env: NodeJS.ProcessEnv, name: string): number | null {
  const value = getOptionalEnv(env, name);

  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_CONFIG_INVALID",
      500,
      `${name} must be a positive integer when provided`,
    );
  }

  return parsed;
}

export function loadHubspotObjectSyncConfig(
  env: NodeJS.ProcessEnv = process.env,
): HubspotObjectSyncConfig {
  const campaignClientObjectIdProperty = getOptionalEnv(
    env,
    "HUBSPOT_CAMPAIGN_CLIENT_OBJECT_ID_PROPERTY",
  );
  const campaignClientAssociationTypeId = getOptionalPositiveIntEnv(
    env,
    "HUBSPOT_CAMPAIGN_CLIENT_ASSOCIATION_TYPE_ID",
  );

  if (campaignClientObjectIdProperty && campaignClientAssociationTypeId) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_CONFIG_AMBIGUOUS",
      500,
      "Set either HUBSPOT_CAMPAIGN_CLIENT_OBJECT_ID_PROPERTY or HUBSPOT_CAMPAIGN_CLIENT_ASSOCIATION_TYPE_ID, not both",
    );
  }

  if (!campaignClientObjectIdProperty && !campaignClientAssociationTypeId) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_CONFIG_MISSING",
      500,
      "HUBSPOT_CAMPAIGN_CLIENT_OBJECT_ID_PROPERTY or HUBSPOT_CAMPAIGN_CLIENT_ASSOCIATION_TYPE_ID is required for HubSpot campaign-client mapping",
    );
  }

  return {
    client: {
      objectType: getRequiredEnv(env, "HUBSPOT_CLIENT_OBJECT_TYPE"),
      nameProperty: getRequiredEnv(env, "HUBSPOT_CLIENT_NAME_PROPERTY"),
      domainProperty: getOptionalEnv(env, "HUBSPOT_CLIENT_DOMAIN_PROPERTY"),
      countryRegionProperty: getOptionalEnv(env, "HUBSPOT_CLIENT_COUNTRY_REGION_PROPERTY"),
      cityProperty: getOptionalEnv(env, "HUBSPOT_CLIENT_CITY_PROPERTY"),
      activeProperty: getOptionalEnv(env, "HUBSPOT_CLIENT_ACTIVE_PROPERTY"),
    },
    campaign: {
      objectType: getRequiredEnv(env, "HUBSPOT_CAMPAIGN_OBJECT_TYPE"),
      nameProperty: getRequiredEnv(env, "HUBSPOT_CAMPAIGN_NAME_PROPERTY"),
      clientObjectIdProperty: campaignClientObjectIdProperty,
      clientAssociationTypeId: campaignClientAssociationTypeId,
      marketProperty: getOptionalEnv(env, "HUBSPOT_CAMPAIGN_MARKET_PROPERTY"),
      briefLinkProperty: getOptionalEnv(env, "HUBSPOT_CAMPAIGN_BRIEF_LINK_PROPERTY"),
      monthProperty: getOptionalEnv(env, "HUBSPOT_CAMPAIGN_MONTH_PROPERTY"),
      yearProperty: getOptionalEnv(env, "HUBSPOT_CAMPAIGN_YEAR_PROPERTY"),
      activeProperty: getOptionalEnv(env, "HUBSPOT_CAMPAIGN_ACTIVE_PROPERTY"),
    },
  };
}

function unique(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value?.trim();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function getRecordProperty(record: HubspotCustomObjectRecord, propertyName: string): string | null {
  const value = record.properties[propertyName];

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function getRequiredRecordProperty(
  record: HubspotCustomObjectRecord,
  propertyName: string,
  label: string,
): string {
  const value = getRecordProperty(record, propertyName);

  if (!value) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_PROPERTY_MISSING",
      500,
      `HubSpot ${label} property "${propertyName}" is missing or empty on object ${record.id}`,
    );
  }

  return value;
}

function parseHubspotActiveFlag(
  record: HubspotCustomObjectRecord,
  propertyName: string | null,
): boolean {
  if (record.archived) {
    return false;
  }

  if (!propertyName) {
    return true;
  }

  const rawValue = getRequiredRecordProperty(record, propertyName, "active flag");
  const normalized = rawValue.toLowerCase();

  if (["true", "yes", "1", "active"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "0", "inactive", "archived"].includes(normalized)) {
    return false;
  }

  throw new ServiceError(
    "HUBSPOT_OBJECT_SYNC_ACTIVE_FLAG_INVALID",
    500,
    `HubSpot active flag property "${propertyName}" has unsupported value "${rawValue}" on object ${record.id}`,
  );
}

function parseRunMonth(
  record: HubspotCustomObjectRecord,
  propertyName: string | null,
): RunMonth | null {
  if (!propertyName) {
    return null;
  }

  const rawValue = getRecordProperty(record, propertyName);

  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.toLowerCase().trim();
  const byName: Record<string, RunMonth> = {
    january: RunMonth.JANUARY,
    jan: RunMonth.JANUARY,
    "1": RunMonth.JANUARY,
    february: RunMonth.FEBRUARY,
    feb: RunMonth.FEBRUARY,
    "2": RunMonth.FEBRUARY,
    march: RunMonth.MARCH,
    mar: RunMonth.MARCH,
    "3": RunMonth.MARCH,
    april: RunMonth.APRIL,
    apr: RunMonth.APRIL,
    "4": RunMonth.APRIL,
    may: RunMonth.MAY,
    "5": RunMonth.MAY,
    june: RunMonth.JUNE,
    jun: RunMonth.JUNE,
    "6": RunMonth.JUNE,
    july: RunMonth.JULY,
    jul: RunMonth.JULY,
    "7": RunMonth.JULY,
    august: RunMonth.AUGUST,
    aug: RunMonth.AUGUST,
    "8": RunMonth.AUGUST,
    september: RunMonth.SEPTEMBER,
    sep: RunMonth.SEPTEMBER,
    sept: RunMonth.SEPTEMBER,
    "9": RunMonth.SEPTEMBER,
    october: RunMonth.OCTOBER,
    oct: RunMonth.OCTOBER,
    "10": RunMonth.OCTOBER,
    november: RunMonth.NOVEMBER,
    nov: RunMonth.NOVEMBER,
    "11": RunMonth.NOVEMBER,
    december: RunMonth.DECEMBER,
    dec: RunMonth.DECEMBER,
    "12": RunMonth.DECEMBER,
  };
  const month = byName[normalized];

  if (!month) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_MONTH_INVALID",
      500,
      `HubSpot campaign month property "${propertyName}" has unsupported value "${rawValue}" on object ${record.id}`,
    );
  }

  return month;
}

function parseYear(record: HubspotCustomObjectRecord, propertyName: string | null): number | null {
  if (!propertyName) {
    return null;
  }

  const rawValue = getRecordProperty(record, propertyName);

  if (!rawValue) {
    return null;
  }

  const year = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_YEAR_INVALID",
      500,
      `HubSpot campaign year property "${propertyName}" has unsupported value "${rawValue}" on object ${record.id}`,
    );
  }

  return year;
}

function toSyncRunStatus(
  status: PrismaHubspotObjectSyncRunStatus,
): HubspotObjectSyncRun["status"] {
  switch (status) {
    case PrismaHubspotObjectSyncRunStatus.RUNNING:
      return "running";
    case PrismaHubspotObjectSyncRunStatus.COMPLETED:
      return "completed";
    case PrismaHubspotObjectSyncRunStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

function toObjectTypes(value: Prisma.JsonValue): HubspotObjectSyncObjectType[] {
  if (!Array.isArray(value)) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_RUN_INVALID",
      500,
      "HubSpot object sync run object types are invalid",
    );
  }

  return value.map((item) => hubspotObjectSyncObjectTypeSchema.parse(item));
}

function toSyncRun(run: SyncRunRecord): HubspotObjectSyncRun {
  return {
    id: run.id,
    status: toSyncRunStatus(run.status),
    objectTypes: toObjectTypes(run.objectTypes),
    clientUpsertCount: run.clientUpsertCount,
    campaignUpsertCount: run.campaignUpsertCount,
    deactivatedCount: run.deactivatedCount,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    lastError: run.lastError,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

async function getAdminUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      role: true,
    },
  });

  if (!user) {
    throw new ServiceError("USER_NOT_FOUND", 404, "User not found");
  }

  if (user.role !== Role.ADMIN) {
    throw new ServiceError("HUBSPOT_OBJECT_SYNC_FORBIDDEN", 403, "Forbidden");
  }
}

async function loadSyncRun(syncRunId: string): Promise<HubspotObjectSyncRun> {
  const syncRunDelegate = getHubspotObjectSyncRunDelegate();
  const run = await syncRunDelegate.findUnique({
    where: {
      id: syncRunId,
    },
    select: syncRunSelect,
  });

  if (!run) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_RUN_NOT_FOUND",
      404,
      "HubSpot object sync run not found",
    );
  }

  return toSyncRun(run);
}

async function fetchAllHubspotObjects(input: {
  objectType: string;
  properties: string[];
}): Promise<HubspotCustomObjectRecord[]> {
  return fetchAllHubspotObjectsPage({
    ...input,
    archived: false,
  });
}

async function fetchAllHubspotObjectsPage(input: {
  objectType: string;
  properties: string[];
  archived: boolean;
}): Promise<HubspotCustomObjectRecord[]> {
  const records: HubspotCustomObjectRecord[] = [];
  let after: string | null = null;

  do {
    const page = await fetchHubspotCustomObjects({
      objectType: input.objectType,
      properties: input.properties,
      archived: input.archived,
      ...(after ? { after } : {}),
    });

    records.push(...page.results);
    after = page.nextAfter;
  } while (after);

  return records;
}

async function syncClients(input: {
  config: HubspotObjectSyncConfig;
  now: Date;
}): Promise<SyncClientsResult> {
  const properties = unique([
    input.config.client.nameProperty,
    input.config.client.domainProperty,
    input.config.client.countryRegionProperty,
    input.config.client.cityProperty,
    input.config.client.activeProperty,
  ]);
  const records = await fetchAllHubspotObjects({
    objectType: input.config.client.objectType,
    properties,
  });
  const syncedClients: SyncedClient[] = [];
  let upsertCount = 0;
  let deactivatedCount = 0;

  for (const record of records) {
    const name = getRequiredRecordProperty(record, input.config.client.nameProperty, "client name");
    const isActive = parseHubspotActiveFlag(record, input.config.client.activeProperty);
    const existing = await prisma.client.findFirst({
      where: {
        OR: [
          {
            hubspotObjectType: input.config.client.objectType,
            hubspotObjectId: record.id,
          },
          {
            name: {
              equals: name,
              mode: "insensitive",
            },
          },
        ],
      },
      select: {
        id: true,
        isActive: true,
      },
    });

    const data = {
      name,
      domain: input.config.client.domainProperty
        ? getRecordProperty(record, input.config.client.domainProperty)
        : null,
      countryRegion: input.config.client.countryRegionProperty
        ? getRecordProperty(record, input.config.client.countryRegionProperty)
        : null,
      city: input.config.client.cityProperty
        ? getRecordProperty(record, input.config.client.cityProperty)
        : null,
      isActive,
      hubspotObjectId: record.id,
      hubspotObjectType: input.config.client.objectType,
      hubspotArchived: record.archived,
      hubspotSyncedAt: input.now,
      hubspotRawPayload: toJsonValue(record),
    };

    const synced = existing
      ? await prisma.client.update({
          where: {
            id: existing.id,
          },
          data,
          select: {
            id: true,
          },
        })
      : await prisma.client.create({
          data,
          select: {
            id: true,
          },
        });

    upsertCount += 1;

    if ((existing?.isActive ?? true) && !isActive) {
      deactivatedCount += 1;
    }

    syncedClients.push({
      id: synced.id,
      hubspotObjectId: record.id,
    });
  }

  const seenObjectIds = syncedClients.map((client) => client.hubspotObjectId);
  return {
    syncedClients,
    upsertCount,
    deactivatedCount,
    activeHubspotObjectIds: seenObjectIds,
  };
}

async function fetchCampaignClientAssociations(input: {
  config: HubspotObjectSyncConfig;
  campaignObjectIds: string[];
}): Promise<Map<string, string[]>> {
  const associationsByCampaignId = new Map<string, string[]>();

  for (let index = 0; index < input.campaignObjectIds.length; index += 1000) {
    const objectIds = input.campaignObjectIds.slice(index, index + 1000);

    if (objectIds.length === 0) {
      continue;
    }

    const associations = await fetchHubspotAssociations({
      fromObjectType: input.config.campaign.objectType,
      toObjectType: input.config.client.objectType,
      objectIds,
      ...(input.config.campaign.clientAssociationTypeId
        ? { associationTypeId: input.config.campaign.clientAssociationTypeId }
        : {}),
    });

    for (const [fromObjectId, toObjectIds] of associations) {
      associationsByCampaignId.set(fromObjectId, toObjectIds);
    }
  }

  return associationsByCampaignId;
}

function resolveCampaignClientObjectId(input: {
  config: HubspotObjectSyncConfig;
  record: HubspotCustomObjectRecord;
  associationsByCampaignId: Map<string, string[]>;
}): CampaignClientResolution {
  if (input.config.campaign.clientObjectIdProperty) {
    return {
      campaignObjectId: input.record.id,
      clientObjectId: getRecordProperty(input.record, input.config.campaign.clientObjectIdProperty),
    };
  }

  const associatedClientIds = input.associationsByCampaignId.get(input.record.id) ?? [];

  if (associatedClientIds.length !== 1) {
    return {
      campaignObjectId: input.record.id,
      clientObjectId: null,
    };
  }

  return {
    campaignObjectId: input.record.id,
    clientObjectId: associatedClientIds[0] as string,
  };
}

async function deactivateSkippedCampaignRecord(input: {
  config: HubspotObjectSyncConfig;
  record: HubspotCustomObjectRecord;
  now: Date;
}): Promise<number> {
  const existing = await prisma.campaign.findFirst({
    where: {
      hubspotObjectType: input.config.campaign.objectType,
      hubspotObjectId: input.record.id,
    },
    select: {
      id: true,
      isActive: true,
    },
  });

  if (!existing) {
    return 0;
  }

  await prisma.campaign.update({
    where: {
      id: existing.id,
    },
    data: {
      isActive: false,
      hubspotArchived: input.record.archived,
      hubspotSyncedAt: input.now,
      hubspotRawPayload: toJsonValue(input.record),
    },
  });

  return existing.isActive ? 1 : 0;
}

async function syncCampaigns(input: {
  config: HubspotObjectSyncConfig;
  clients: SyncedClient[];
  now: Date;
}): Promise<SyncCampaignsResult> {
  const properties = unique([
    input.config.campaign.nameProperty,
    input.config.campaign.clientObjectIdProperty,
    input.config.campaign.marketProperty,
    input.config.campaign.briefLinkProperty,
    input.config.campaign.monthProperty,
    input.config.campaign.yearProperty,
    input.config.campaign.activeProperty,
  ]);
  const records = await fetchAllHubspotObjects({
    objectType: input.config.campaign.objectType,
    properties,
  });
  const clientsByHubspotId = new Map(
    input.clients.map((client) => [client.hubspotObjectId, client.id]),
  );
  const associationsByCampaignId = input.config.campaign.clientObjectIdProperty
    ? new Map<string, string[]>()
    : await fetchCampaignClientAssociations({
        config: input.config,
        campaignObjectIds: records.map((record) => record.id),
      });
  const seenObjectIds: string[] = [];
  const skippedRecords: SkippedHubspotRecord[] = [];
  let upsertCount = 0;
  let deactivatedCount = 0;

  for (const record of records) {
    try {
      const name = getRequiredRecordProperty(
        record,
        input.config.campaign.nameProperty,
        "campaign name",
      );
      const marketName = input.config.campaign.marketProperty
        ? getRecordProperty(record, input.config.campaign.marketProperty)
        : null;
      const clientResolution = resolveCampaignClientObjectId({
        config: input.config,
        record,
        associationsByCampaignId,
      });
      const clientId = clientResolution.clientObjectId
        ? clientsByHubspotId.get(clientResolution.clientObjectId) ?? null
        : null;

      const month = parseRunMonth(record, input.config.campaign.monthProperty);
      const year = parseYear(record, input.config.campaign.yearProperty);
      const isActive = parseHubspotActiveFlag(record, input.config.campaign.activeProperty);
      const market = marketName
        ? await prisma.market.upsert({
            where: {
              name: marketName,
            },
            create: {
              name: marketName,
            },
            update: {},
            select: {
              id: true,
            },
          })
        : null;
      const existing = await prisma.campaign.findFirst({
        where: {
          OR: [
            {
              hubspotObjectType: input.config.campaign.objectType,
              hubspotObjectId: record.id,
            },
            {
              name,
              clientId,
              marketId: market?.id ?? null,
              month,
              year,
            },
          ],
        },
        select: {
          id: true,
          isActive: true,
        },
      });
      const data: CampaignSyncData = {
        name,
        clientId,
        marketId: market?.id ?? null,
        briefLink: input.config.campaign.briefLinkProperty
          ? getRecordProperty(record, input.config.campaign.briefLinkProperty)
          : null,
        month,
        year,
        isActive,
        hubspotObjectId: record.id,
        hubspotObjectType: input.config.campaign.objectType,
        hubspotArchived: record.archived,
        hubspotSyncedAt: input.now,
        hubspotRawPayload: toJsonValue(record),
      };

      if (existing) {
        try {
          await prisma.campaign.update({
            where: {
              id: existing.id,
            },
            data,
          });
        } catch (error) {
          if (!isCampaignNullConstraintError(error, data)) {
            throw error;
          }

          await prisma.campaign.update({
            where: {
              id: existing.id,
            },
            data: toLegacyCompatibleCampaignUpdateData(data),
          });
        }
      } else {
        try {
          await prisma.campaign.create({
            data,
          });
        } catch (error) {
          if (!isCampaignNullConstraintError(error, data)) {
            throw error;
          }

          throw new ServiceError(
            "HUBSPOT_OBJECT_SYNC_CAMPAIGN_SCHEMA_INCOMPATIBLE",
            500,
            `HubSpot campaign object ${record.id} omitted client, market, month, or year values that are still required by the local campaigns table`,
          );
        }
      }

      upsertCount += 1;

      if ((existing?.isActive ?? true) && !isActive) {
        deactivatedCount += 1;
      }

      seenObjectIds.push(record.id);
    } catch (error) {
      if (!isSkippableCampaignRecordError(error)) {
        throw error;
      }

      skippedRecords.push({
        objectId: record.id,
        reason: formatErrorMessage(error),
      });
      deactivatedCount += await deactivateSkippedCampaignRecord({
        config: input.config,
        record,
        now: input.now,
      });
      seenObjectIds.push(record.id);
    }
  }

  const deleted = await prisma.campaign.deleteMany({
    where: {
      hubspotObjectType: input.config.campaign.objectType,
      hubspotObjectId: hubspotObjectIdRetentionFilter(seenObjectIds),
    },
  });

  deactivatedCount += deleted.count;

  return {
    upsertCount,
    deactivatedCount,
    lastError: formatSkippedHubspotRecords(skippedRecords),
    activeHubspotObjectIds: seenObjectIds,
  };
}

async function deleteStaleHubspotClients(input: {
  config: HubspotObjectSyncConfig;
  activeHubspotObjectIds: string[];
}): Promise<number> {
  const deleted = await prisma.client.deleteMany({
    where: {
      hubspotObjectType: input.config.client.objectType,
      hubspotObjectId: hubspotObjectIdRetentionFilter(input.activeHubspotObjectIds),
    },
  });

  return deleted.count;
}

async function performHubspotObjectSync(input: {
  config: HubspotObjectSyncConfig;
  requestedByUserId: string;
}): Promise<SyncCounts> {
  const now = new Date();
  const clientResult = await syncClients({
    config: input.config,
    now,
  });
  const campaignResult = await syncCampaigns({
    config: input.config,
    clients: clientResult.syncedClients,
    now,
  });
  const deletedClientCount = await deleteStaleHubspotClients({
    config: input.config,
    activeHubspotObjectIds: clientResult.activeHubspotObjectIds,
  });
  await syncHubspotDropdownValues({
    actorUserId: input.requestedByUserId,
  });

  return {
    clientUpsertCount: clientResult.upsertCount,
    campaignUpsertCount: campaignResult.upsertCount,
    deactivatedCount:
      clientResult.deactivatedCount + campaignResult.deactivatedCount + deletedClientCount,
    lastError: campaignResult.lastError,
  };
}

export async function createHubspotObjectSyncRun(input: {
  requestedByUserId: string;
}): Promise<HubspotObjectSyncRun> {
  await getAdminUser(input.requestedByUserId);

  let syncRunId = "";

  await withDbTransaction(async (tx) => {
    const syncRunDelegate = getHubspotObjectSyncRunDelegate(
      tx as unknown as HubspotObjectSyncRunAccessor,
    );
    const run = await syncRunDelegate.create({
      data: {
        requestedByUserId: input.requestedByUserId,
        objectTypes: toJsonValue(OBJECT_TYPES),
      },
      select: {
        id: true,
      },
    });

    syncRunId = run.id;

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "hubspot_object_sync.requested",
        entityType: "hubspot_object_sync_run",
        entityId: run.id,
        metadata: toJsonValue({
          objectTypes: OBJECT_TYPES,
        }),
      },
    });
  });

  await enqueueHubspotObjectSyncJob({
    syncRunId,
    requestedByUserId: input.requestedByUserId,
  });

  return loadSyncRun(syncRunId);
}

export async function listHubspotObjectSyncRuns(input: {
  requestedByUserId: string;
  limit?: number;
}): Promise<ListHubspotObjectSyncRunsResponse> {
  await getAdminUser(input.requestedByUserId);

  const syncRunDelegate = getHubspotObjectSyncRunDelegate();
  const runs = await syncRunDelegate.findMany({
    where: {
      requestedByUserId: input.requestedByUserId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: input.limit ?? 10,
    select: syncRunSelect,
  });
  const items = runs.map(toSyncRun);

  return {
    items,
    latest: items[0] ?? null,
  };
}

export async function executeHubspotObjectSyncRun(input: {
  syncRunId: string;
  requestedByUserId: string;
}): Promise<HubspotObjectSyncRun> {
  const syncRunDelegate = getHubspotObjectSyncRunDelegate();
  const run = await syncRunDelegate.findUnique({
    where: {
      id: input.syncRunId,
    },
    select: {
      id: true,
      requestedByUserId: true,
      status: true,
    },
  });

  if (!run || run.requestedByUserId !== input.requestedByUserId) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_RUN_NOT_FOUND",
      404,
      "HubSpot object sync run not found",
    );
  }

  if (
    run.status === PrismaHubspotObjectSyncRunStatus.RUNNING ||
    run.status === PrismaHubspotObjectSyncRunStatus.COMPLETED
  ) {
    return loadSyncRun(run.id);
  }

  const claimed = await syncRunDelegate.updateMany({
    where: {
      id: run.id,
      status: {
        in: [PrismaHubspotObjectSyncRunStatus.QUEUED, PrismaHubspotObjectSyncRunStatus.FAILED],
      },
    },
    data: {
      status: PrismaHubspotObjectSyncRunStatus.RUNNING,
      startedAt: new Date(),
      completedAt: null,
      lastError: null,
      clientUpsertCount: 0,
      campaignUpsertCount: 0,
      deactivatedCount: 0,
    },
  });

  if (claimed.count === 0) {
    return loadSyncRun(run.id);
  }

  try {
    const config = loadHubspotObjectSyncConfig();
    const counts = await performHubspotObjectSync({
      config,
      requestedByUserId: input.requestedByUserId,
    });

    await syncRunDelegate.update({
      where: {
        id: run.id,
      },
      data: {
        status: PrismaHubspotObjectSyncRunStatus.COMPLETED,
        clientUpsertCount: counts.clientUpsertCount,
        campaignUpsertCount: counts.campaignUpsertCount,
        deactivatedCount: counts.deactivatedCount,
        completedAt: new Date(),
        lastError: counts.lastError,
      },
    });

    await recordAuditEvent({
      actorUserId: input.requestedByUserId,
      action: "hubspot_object_sync.completed",
      entityType: "hubspot_object_sync_run",
      entityId: run.id,
      metadata: counts,
    });
  } catch (error) {
    const message = formatErrorMessage(error);

    await syncRunDelegate.update({
      where: {
        id: run.id,
      },
      data: {
        status: PrismaHubspotObjectSyncRunStatus.FAILED,
        completedAt: new Date(),
        lastError: message,
      },
    });

    await recordAuditEvent({
      actorUserId: input.requestedByUserId,
      action: "hubspot_object_sync.failed",
      entityType: "hubspot_object_sync_run",
      entityId: run.id,
      metadata: {
        lastError: message,
      },
    });

    throw error;
  }

  return loadSyncRun(run.id);
}
