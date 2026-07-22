import { randomUUID } from "node:crypto";

import {
  HubspotObjectSyncMode as PrismaHubspotObjectSyncMode,
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
import { prisma, withDbTransaction, type DbTransactionClient } from "@scouting-platform/db";
import {
  fetchHubspotAccountIdentity,
  fetchHubspotAssociationLabels,
  fetchHubspotAssociations,
  fetchHubspotCustomObjects,
  fetchHubspotOwners,
  fetchHubspotPipelines,
  loadHubspotConfig,
  searchHubspotObjectsUpdatedAfter,
  type HubspotAssociationLabel,
  type HubspotCustomObjectRecord,
  type HubspotOwner as ProviderHubspotOwner,
} from "@scouting-platform/integrations";

import { recordAuditEvent } from "../audit";
import { syncHubspotDropdownValues } from "../dropdown-values";
import { ServiceError } from "../errors";
import {
  loadHubspotCollaborationSnapshot,
  persistHubspotCollaborationSnapshot,
  type HubspotCollaborationSyncConfig,
} from "./collaboration-sync";
import { enqueueHubspotObjectSyncJob } from "./queue";
import { getHubspotIncrementalCursorStart } from "./reconciliation-domain";

const OBJECT_TYPES: HubspotObjectSyncObjectType[] = [
  "clients",
  "campaigns",
  "dropdownValues",
  "owners",
  "pipelines",
  "associationDefinitions",
  "schemas",
  "collaborationHistory",
];

const SYNC_LEASE_MS = 30 * 60 * 1_000;
const SYNC_LEASE_HEARTBEAT_MS = 60 * 1_000;

const syncRunSelect = {
  id: true,
  status: true,
  mode: true,
  fullReconciliation: true,
  objectTypes: true,
  highWaterMark: true,
  clientUpsertCount: true,
  campaignUpsertCount: true,
  dealMirrorUpsertCount: true,
  activationMirrorUpsertCount: true,
  deactivatedCount: true,
  warningCount: true,
  warnings: true,
  hubspotPortal: {
    select: {
      portalId: true,
    },
  },
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
  activationObjectType: string;
  collaboration: HubspotCollaborationSyncConfig;
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
    statusProperty: string;
    activeProperty: string | null;
  }>;
}>;

type SyncCounts = Readonly<{
  clientUpsertCount: number;
  campaignUpsertCount: number;
  dealMirrorUpsertCount: number;
  activationMirrorUpsertCount: number;
  deactivatedCount: number;
  warnings: string[];
  highWaterMark: Date;
}>;

type SyncedClient = Readonly<{
  id: string;
  hubspotObjectId: string;
}>;

type SyncClientsResult = Readonly<{
  syncedClients: SyncedClient[];
  upsertCount: number;
  deactivatedCount: number;
}>;

type SyncCampaignsResult = Readonly<{
  upsertCount: number;
  deactivatedCount: number;
  warnings: string[];
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
  status: string | null;
  isActive: boolean;
  hubspotPortalId: string;
  hubspotObjectId: string;
  hubspotObjectType: string;
  hubspotArchived: boolean;
  hubspotSyncedAt: Date;
  hubspotRawPayload: Prisma.InputJsonValue;
}>;

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

function createObjectSyncLeaseLostError(syncRunId: string): ServiceError {
  return new ServiceError(
    "HUBSPOT_OBJECT_SYNC_LEASE_LOST",
    409,
    `HubSpot object sync run ${syncRunId} lost its execution lease`,
  );
}

type ObjectSyncLeaseHeartbeat = Readonly<{
  attachPortal: (hubspotPortalId: string) => void;
  renewNow: () => Promise<void>;
  stop: () => Promise<void>;
}>;

type ObjectSyncLeaseContext = Readonly<{
  syncRunId: string;
  hubspotPortalId: string;
  leaseOwner: string;
}>;

async function renewObjectSyncRunLeaseInTransaction(
  tx: DbTransactionClient,
  input: Pick<ObjectSyncLeaseContext, "syncRunId" | "leaseOwner">,
  leaseExpiresAt: Date,
): Promise<void> {
  const syncRunDelegate = getHubspotObjectSyncRunDelegate(
    tx as unknown as HubspotObjectSyncRunAccessor,
  );
  const renewedRun = await syncRunDelegate.updateMany({
    where: {
      id: input.syncRunId,
      status: PrismaHubspotObjectSyncRunStatus.RUNNING,
      leaseOwner: input.leaseOwner,
    },
    data: {
      leaseExpiresAt,
    },
  });

  if (renewedRun.count === 0) {
    throw createObjectSyncLeaseLostError(input.syncRunId);
  }
}

async function renewObjectSyncPortalLeaseInTransaction(
  tx: DbTransactionClient,
  input: ObjectSyncLeaseContext,
  leaseExpiresAt: Date,
): Promise<void> {
  const renewedPortal = await tx.hubspotPortal.updateMany({
    where: {
      id: input.hubspotPortalId,
      objectSyncLeaseOwner: input.leaseOwner,
    },
    data: {
      objectSyncLeaseExpiresAt: leaseExpiresAt,
    },
  });

  if (renewedPortal.count === 0) {
    throw createObjectSyncLeaseLostError(input.syncRunId);
  }
}

async function renewObjectSyncLeaseInTransaction(
  tx: DbTransactionClient,
  input: ObjectSyncLeaseContext,
  leaseExpiresAt: Date,
): Promise<void> {
  await renewObjectSyncRunLeaseInTransaction(tx, input, leaseExpiresAt);
  await renewObjectSyncPortalLeaseInTransaction(tx, input, leaseExpiresAt);
}

async function withOwnedObjectSyncMutation<T>(
  lease: ObjectSyncLeaseContext,
  mutation: (tx: DbTransactionClient) => Promise<T>,
): Promise<T> {
  return withDbTransaction(async (tx) => {
    await renewObjectSyncLeaseInTransaction(
      tx,
      lease,
      new Date(Date.now() + SYNC_LEASE_MS),
    );
    return mutation(tx);
  });
}

function startObjectSyncLeaseHeartbeat(input: {
  syncRunId: string;
  leaseOwner: string;
}): ObjectSyncLeaseHeartbeat {
  let hubspotPortalId: string | null = null;
  let stopped = false;
  let hasFailed = false;
  let failure: unknown;
  let inFlight: Promise<void> | null = null;

  const assertHealthy = (): void => {
    if (hasFailed) {
      throw failure;
    }
  };

  const renewLease = async (): Promise<void> => {
    const renewalPortalId = hubspotPortalId;
    const leaseExpiresAt = new Date(Date.now() + SYNC_LEASE_MS);

    await withDbTransaction(async (tx) => {
      if (!renewalPortalId) {
        await renewObjectSyncRunLeaseInTransaction(tx, input, leaseExpiresAt);
        return;
      }

      await renewObjectSyncLeaseInTransaction(
        tx,
        {
          ...input,
          hubspotPortalId: renewalPortalId,
        },
        leaseExpiresAt,
      );

      await tx.hubspotSyncCursor.updateMany({
        where: {
          hubspotPortalId: renewalPortalId,
          leaseOwner: input.leaseOwner,
        },
        data: {
          leaseExpiresAt,
        },
      });
    });
  };

  const triggerRenewal = (): Promise<void> => {
    if (stopped || hasFailed || inFlight) {
      return inFlight ?? Promise.resolve();
    }

    const renewal = renewLease()
      .catch((error: unknown) => {
        hasFailed = true;
        failure = error;
      })
      .finally(() => {
        inFlight = null;
      });
    inFlight = renewal;
    return renewal;
  };

  const timer = setInterval(() => {
    void triggerRenewal();
  }, SYNC_LEASE_HEARTBEAT_MS);
  timer.unref();

  return {
    attachPortal(nextHubspotPortalId) {
      hubspotPortalId = nextHubspotPortalId;
    },
    async renewNow() {
      await triggerRenewal();
      assertHealthy();
    },
    async stop() {
      stopped = true;
      clearInterval(timer);

      if (inFlight) {
        await inFlight;
      }

      assertHealthy();
    },
  };
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

function toLegacyCompatibleCampaignUpdateData(data: CampaignSyncData): Prisma.CampaignUncheckedUpdateInput {
  return {
    name: data.name,
    ...(data.clientId === null ? {} : { clientId: data.clientId }),
    ...(data.marketId === null ? {} : { marketId: data.marketId }),
    briefLink: data.briefLink,
    ...(data.month === null ? {} : { month: data.month }),
    ...(data.year === null ? {} : { year: data.year }),
    status: data.status,
    isActive: data.isActive,
    hubspotPortalId: data.hubspotPortalId,
    hubspotObjectId: data.hubspotObjectId,
    hubspotObjectType: data.hubspotObjectType,
    hubspotArchived: data.hubspotArchived,
    hubspotSyncedAt: data.hubspotSyncedAt,
    hubspotRawPayload: data.hubspotRawPayload,
  };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getRequiredMapping(value: string | null, name: string): string {
  if (!value) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_CONFIG_MISSING",
      500,
      `${name} is required for HubSpot Client/Campaign custom object sync`,
    );
  }

  return value;
}

export function loadHubspotObjectSyncConfig(
  env: NodeJS.ProcessEnv = process.env,
): HubspotObjectSyncConfig {
  const central = loadHubspotConfig(env);
  const campaignClientObjectIdProperty =
    central.propertyMappings.campaignClientObjectIdProperty;
  const campaignClientAssociationTypeId =
    central.associationMappings.campaignClientAssociationTypeId;

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
    activationObjectType: getRequiredMapping(
      central.objectMappings.activationObjectType,
      "HUBSPOT_ACTIVATION_OBJECT_TYPE",
    ),
    collaboration: {
      contactWorkedWithProperty: getRequiredMapping(
        central.propertyMappings.contactWorkedWithProperty,
        "HUBSPOT_CONTACT_WORKED_WITH_PROPERTY",
      ),
      clientObjectType: getRequiredMapping(
        central.objectMappings.clientObjectType,
        "HUBSPOT_CLIENT_OBJECT_TYPE",
      ),
      campaignObjectType: getRequiredMapping(
        central.objectMappings.campaignObjectType,
        "HUBSPOT_CAMPAIGN_OBJECT_TYPE",
      ),
      activationObjectType: getRequiredMapping(
        central.objectMappings.activationObjectType,
        "HUBSPOT_ACTIVATION_OBJECT_TYPE",
      ),
      activationNameProperty: getRequiredMapping(
        central.propertyMappings.activationNameProperty,
        "HUBSPOT_ACTIVATION_NAME_PROPERTY",
      ),
      activationTypeProperty: central.propertyMappings.activationTypeProperty,
      activationUrlProperty: central.propertyMappings.activationUrlProperty,
      activationPublicationDateProperty:
        central.propertyMappings.activationPublicationDateProperty,
    },
    client: {
      objectType: getRequiredMapping(
        central.objectMappings.clientObjectType,
        "HUBSPOT_CLIENT_OBJECT_TYPE",
      ),
      nameProperty: getRequiredMapping(
        central.propertyMappings.clientNameProperty,
        "HUBSPOT_CLIENT_NAME_PROPERTY",
      ),
      domainProperty: central.propertyMappings.clientDomainProperty,
      countryRegionProperty: central.propertyMappings.clientCountryRegionProperty,
      cityProperty: central.propertyMappings.clientCityProperty,
      activeProperty: central.propertyMappings.clientActiveProperty,
    },
    campaign: {
      objectType: getRequiredMapping(
        central.objectMappings.campaignObjectType,
        "HUBSPOT_CAMPAIGN_OBJECT_TYPE",
      ),
      nameProperty: getRequiredMapping(
        central.propertyMappings.campaignNameProperty,
        "HUBSPOT_CAMPAIGN_NAME_PROPERTY",
      ),
      clientObjectIdProperty: campaignClientObjectIdProperty,
      clientAssociationTypeId: campaignClientAssociationTypeId,
      marketProperty: central.propertyMappings.campaignMarketProperty,
      briefLinkProperty: central.propertyMappings.campaignBriefLinkProperty,
      monthProperty: central.propertyMappings.campaignMonthProperty,
      yearProperty: central.propertyMappings.campaignYearProperty,
      statusProperty: getRequiredMapping(
        central.propertyMappings.campaignStatusProperty,
        "HUBSPOT_CAMPAIGN_STATUS_PROPERTY",
      ),
      activeProperty: central.propertyMappings.campaignActiveProperty,
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

function toSyncMode(mode: PrismaHubspotObjectSyncMode): HubspotObjectSyncRun["mode"] {
  return mode === PrismaHubspotObjectSyncMode.INCREMENTAL ? "incremental" : "full";
}

function toWarningList(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((warning): warning is string => typeof warning === "string");
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
    mode: toSyncMode(run.mode),
    fullReconciliation: run.fullReconciliation,
    objectTypes: toObjectTypes(run.objectTypes),
    portalId: run.hubspotPortal?.portalId ?? null,
    highWaterMark: run.highWaterMark?.toISOString() ?? null,
    clientUpsertCount: run.clientUpsertCount,
    campaignUpsertCount: run.campaignUpsertCount,
    dealMirrorUpsertCount: run.dealMirrorUpsertCount,
    activationMirrorUpsertCount: run.activationMirrorUpsertCount,
    deactivatedCount: run.deactivatedCount,
    warningCount: run.warningCount,
    warnings: toWarningList(run.warnings),
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

async function getScheduledSyncRequesterUserId(): Promise<string> {
  const user = await prisma.user.findFirst({
    where: {
      role: Role.ADMIN,
      isActive: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_SCHEDULED_REQUESTER_MISSING",
      503,
      "Daily HubSpot sync requires at least one active admin user",
    );
  }

  return user.id;
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

async function fetchAllHubspotOwners(archived: boolean): Promise<ProviderHubspotOwner[]> {
  const owners: ProviderHubspotOwner[] = [];
  let after: string | null = null;

  do {
    const page = await fetchHubspotOwners({
      archived,
      ...(after ? { after } : {}),
    });
    owners.push(...page.results);
    after = page.nextAfter;
  } while (after);

  return owners;
}

async function loadVerifiedHubspotPortalIdentity(): Promise<{
  portalId: string;
  displayName: string | null;
}> {
  const identity = await fetchHubspotAccountIdentity();
  const configuredPortalId = process.env.HUBSPOT_PORTAL_ID?.trim();

  if (configuredPortalId && configuredPortalId !== identity.portalId) {
    throw new ServiceError(
      "HUBSPOT_PORTAL_MISMATCH",
      503,
      `Configured HubSpot portal ${configuredPortalId} does not match authenticated portal ${identity.portalId}`,
    );
  }

  return {
    portalId: identity.portalId,
    displayName: identity.uiDomain ?? null,
  };
}

async function fetchObjectsForSync(input: {
  objectType: string;
  properties: string[];
  mode: PrismaHubspotObjectSyncMode;
  highWaterMark: Date | null;
}): Promise<HubspotCustomObjectRecord[]> {
  let activeRecords: HubspotCustomObjectRecord[] = [];
  const cursorStart = getHubspotIncrementalCursorStart(input.highWaterMark);

  if (input.mode === PrismaHubspotObjectSyncMode.INCREMENTAL && cursorStart) {
    let after: string | null = null;

    do {
      const page = await searchHubspotObjectsUpdatedAfter({
        objectType: input.objectType,
        properties: input.properties,
        updatedAfter: cursorStart,
        ...(after ? { after } : {}),
      });
      activeRecords.push(...page.results);
      after = page.nextAfter;
    } while (after);
  } else {
    activeRecords = await fetchAllHubspotObjectsPage({
      objectType: input.objectType,
      properties: input.properties,
      archived: false,
    });
  }

  // The search API does not expose archived records reliably. Explicit archived reads
  // are therefore reconciled on every run; omission from either response is ignored.
  const archivedRecords = await fetchAllHubspotObjectsPage({
    objectType: input.objectType,
    properties: input.properties,
    archived: true,
  });
  const byId = new Map(activeRecords.map((record) => [record.id, record]));

  for (const record of archivedRecords) {
    byId.set(record.id, { ...record, archived: true });
  }

  return [...byId.values()];
}

function toDateOrNull(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function syncHubspotOwners(input: {
  lease: ObjectSyncLeaseContext;
  now: Date;
}): Promise<number> {
  const [activeOwners, archivedOwners] = await Promise.all([
    fetchAllHubspotOwners(false),
    fetchAllHubspotOwners(true),
  ]);
  const ownersById = new Map(activeOwners.map((owner) => [owner.id, owner]));

  for (const owner of archivedOwners) {
    ownersById.set(owner.id, { ...owner, archived: true });
  }

  for (const owner of ownersById.values()) {
    const email = owner.email?.trim() || null;
    const firstName = owner.firstName?.trim() || null;
    const lastName = owner.lastName?.trim() || null;
    const displayName =
      [firstName, lastName].filter(Boolean).join(" ") || email;

    await withOwnedObjectSyncMutation(input.lease, async (tx) => {
      await tx.hubspotOwner.upsert({
        where: {
          hubspotPortalId_hubspotOwnerId: {
            hubspotPortalId: input.lease.hubspotPortalId,
            hubspotOwnerId: owner.id,
          },
        },
        create: {
          hubspotPortalId: input.lease.hubspotPortalId,
          hubspotOwnerId: owner.id,
          email,
          normalizedEmail: email?.toLowerCase() ?? null,
          firstName,
          lastName,
          displayName,
          isActive: !owner.archived,
          archived: owner.archived,
          lastObservedUpdatedAt: toDateOrNull(owner.updatedAt),
          syncedAt: input.now,
        },
        update: {
          email,
          normalizedEmail: email?.toLowerCase() ?? null,
          firstName,
          lastName,
          displayName,
          isActive: !owner.archived,
          archived: owner.archived,
          lastObservedUpdatedAt: toDateOrNull(owner.updatedAt),
          syncedAt: input.now,
        },
      });
    });
  }

  return ownersById.size;
}

async function syncHubspotPipelines(input: {
  lease: ObjectSyncLeaseContext;
  now: Date;
}): Promise<{ pipelineCount: number; stageCount: number }> {
  const [activePipelines, archivedPipelines] = await Promise.all([
    fetchHubspotPipelines({ objectType: "deals", archived: false }),
    fetchHubspotPipelines({ objectType: "deals", archived: true }),
  ]);
  const pipelinesById = new Map(activePipelines.map((pipeline) => [pipeline.id, pipeline]));

  for (const pipeline of archivedPipelines) {
    // HubSpot can repeat active pipelines when archived=true. Trust the
    // record state instead of treating the query parameter as that state.
    pipelinesById.set(pipeline.id, pipeline);
  }

  let stageCount = 0;

  for (const pipeline of pipelinesById.values()) {
    await withOwnedObjectSyncMutation(input.lease, async (tx) => {
      const persisted = await tx.hubspotPipeline.upsert({
        where: {
          hubspotPortalId_objectType_hubspotPipelineId: {
            hubspotPortalId: input.lease.hubspotPortalId,
            objectType: "deals",
            hubspotPipelineId: pipeline.id,
          },
        },
        create: {
          hubspotPortalId: input.lease.hubspotPortalId,
          objectType: "deals",
          hubspotPipelineId: pipeline.id,
          label: pipeline.label,
          displayOrder: pipeline.displayOrder ?? 0,
          archived: pipeline.archived,
          syncedAt: input.now,
        },
        update: {
          label: pipeline.label,
          displayOrder: pipeline.displayOrder ?? 0,
          archived: pipeline.archived,
          syncedAt: input.now,
        },
        select: {
          id: true,
        },
      });

      for (const stage of pipeline.stages) {
        await tx.hubspotPipelineStage.upsert({
          where: {
            pipelineId_hubspotStageId: {
              pipelineId: persisted.id,
              hubspotStageId: stage.id,
            },
          },
          create: {
            pipelineId: persisted.id,
            hubspotStageId: stage.id,
            label: stage.label,
            displayOrder: stage.displayOrder ?? 0,
            archived: pipeline.archived || stage.archived,
            syncedAt: input.now,
          },
          update: {
            label: stage.label,
            displayOrder: stage.displayOrder ?? 0,
            archived: pipeline.archived || stage.archived,
            syncedAt: input.now,
          },
        });
      }
    });
    stageCount += pipeline.stages.length;
  }

  return { pipelineCount: pipelinesById.size, stageCount };
}

type AssociationPair = Readonly<{
  fromObjectType: string;
  toObjectType: string;
}>;

function associationPairs(config: HubspotObjectSyncConfig): AssociationPair[] {
  return [
    { fromObjectType: "contacts", toObjectType: "deals" },
    {
      fromObjectType: "deals",
      toObjectType: config.campaign.objectType,
    },
    {
      fromObjectType: "deals",
      toObjectType: config.client.objectType,
    },
    {
      fromObjectType: config.campaign.objectType,
      toObjectType: config.client.objectType,
    },
  ];
}

async function persistAssociationLabels(input: {
  lease: ObjectSyncLeaseContext;
  pair: AssociationPair;
  labels: HubspotAssociationLabel[];
  now: Date;
}): Promise<void> {
  await withOwnedObjectSyncMutation(input.lease, async (tx) => {
    for (const label of input.labels) {
      await tx.hubspotAssociationDefinition.upsert({
        where: {
          hubspotPortalId_fromObjectType_toObjectType_associationCategory_associationTypeId: {
            hubspotPortalId: input.lease.hubspotPortalId,
            fromObjectType: input.pair.fromObjectType,
            toObjectType: input.pair.toObjectType,
            associationCategory: label.category,
            associationTypeId: label.typeId,
          },
        },
        create: {
          hubspotPortalId: input.lease.hubspotPortalId,
          fromObjectType: input.pair.fromObjectType,
          toObjectType: input.pair.toObjectType,
          associationCategory: label.category,
          associationTypeId: label.typeId,
          label: label.label,
          isUserDefined: label.category === "USER_DEFINED",
          archived: false,
          syncedAt: input.now,
        },
        update: {
          label: label.label,
          isUserDefined: label.category === "USER_DEFINED",
          archived: false,
          syncedAt: input.now,
        },
      });
    }
  });
}

async function syncHubspotAssociationDefinitions(input: {
  lease: ObjectSyncLeaseContext;
  config: HubspotObjectSyncConfig;
  now: Date;
}): Promise<{ count: number; warnings: string[] }> {
  let count = 0;

  for (const pair of associationPairs(input.config)) {
    const labels = await fetchHubspotAssociationLabels(pair);
    await persistAssociationLabels({
      lease: input.lease,
      pair,
      labels,
      now: input.now,
    });
    count += labels.length;
  }

  return { count, warnings: [] };
}

async function syncClients(input: {
  lease: ObjectSyncLeaseContext;
  config: HubspotObjectSyncConfig;
  mode: PrismaHubspotObjectSyncMode;
  highWaterMark: Date | null;
  now: Date;
}): Promise<SyncClientsResult> {
  const properties = unique([
    input.config.client.nameProperty,
    input.config.client.domainProperty,
    input.config.client.countryRegionProperty,
    input.config.client.cityProperty,
    input.config.client.activeProperty,
  ]);
  const records = await fetchObjectsForSync({
    objectType: input.config.client.objectType,
    properties,
    mode: input.mode,
    highWaterMark: input.highWaterMark,
  });
  const syncedClients: SyncedClient[] = [];
  let upsertCount = 0;
  let deactivatedCount = 0;

  for (const record of records) {
    if (record.archived) {
      const archivedClient = await withOwnedObjectSyncMutation(input.lease, async (tx) => {
        const existing = await tx.client.findFirst({
          where: {
            OR: [
              {
                hubspotPortalId: input.lease.hubspotPortalId,
                hubspotObjectType: input.config.client.objectType,
                hubspotObjectId: record.id,
              },
              {
                hubspotPortalId: null,
                hubspotObjectType: input.config.client.objectType,
                hubspotObjectId: record.id,
              },
            ],
          },
          select: { id: true, isActive: true },
        });

        if (!existing) {
          return null;
        }

        await tx.client.update({
          where: { id: existing.id },
          data: {
            isActive: false,
            hubspotPortalId: input.lease.hubspotPortalId,
            hubspotArchived: true,
            hubspotSyncedAt: input.now,
            hubspotRawPayload: toJsonValue(record),
          },
        });
        return existing;
      });

      if (archivedClient) {
        deactivatedCount += archivedClient.isActive ? 1 : 0;
        syncedClients.push({ id: archivedClient.id, hubspotObjectId: record.id });
      }

      continue;
    }

    const name = getRequiredRecordProperty(record, input.config.client.nameProperty, "client name");
    const isActive = parseHubspotActiveFlag(record, input.config.client.activeProperty);
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
      hubspotPortalId: input.lease.hubspotPortalId,
      hubspotObjectId: record.id,
      hubspotObjectType: input.config.client.objectType,
      hubspotArchived: record.archived,
      hubspotSyncedAt: input.now,
      hubspotRawPayload: toJsonValue(record),
    };

    const synced = await withOwnedObjectSyncMutation(input.lease, async (tx) => {
      const existing = await tx.client.findFirst({
        where: {
          OR: [
            {
              hubspotPortalId: input.lease.hubspotPortalId,
              hubspotObjectType: input.config.client.objectType,
              hubspotObjectId: record.id,
            },
            {
              hubspotPortalId: null,
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
      const persisted = existing
        ? await tx.client.update({
            where: {
              id: existing.id,
            },
            data,
            select: {
              id: true,
            },
          })
        : await tx.client.create({
            data,
            select: {
              id: true,
            },
          });

      return {
        id: persisted.id,
        wasActive: existing?.isActive ?? true,
      };
    });

    upsertCount += 1;

    if (synced.wasActive && !isActive) {
      deactivatedCount += 1;
    }

    syncedClients.push({
      id: synced.id,
      hubspotObjectId: record.id,
    });
  }

  return {
    syncedClients,
    upsertCount,
    deactivatedCount,
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

async function syncCampaigns(input: {
  lease: ObjectSyncLeaseContext;
  config: HubspotObjectSyncConfig;
  mode: PrismaHubspotObjectSyncMode;
  highWaterMark: Date | null;
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
    input.config.campaign.statusProperty,
    input.config.campaign.activeProperty,
  ]);
  const records = await fetchObjectsForSync({
    objectType: input.config.campaign.objectType,
    properties,
    mode: input.mode,
    highWaterMark: input.highWaterMark,
  });
  const persistedClients = await prisma.client.findMany({
    where: {
      hubspotPortalId: input.lease.hubspotPortalId,
      hubspotObjectType: input.config.client.objectType,
      hubspotObjectId: { not: null },
    },
    select: { id: true, hubspotObjectId: true },
  });
  const clientsByHubspotId = new Map(
    [...persistedClients, ...input.clients]
      .filter(
        (client): client is { id: string; hubspotObjectId: string } =>
          typeof client.hubspotObjectId === "string",
      )
      .map((client) => [client.hubspotObjectId, client.id]),
  );
  const associationsByCampaignId = input.config.campaign.clientObjectIdProperty
    ? new Map<string, string[]>()
    : await fetchCampaignClientAssociations({
        config: input.config,
        campaignObjectIds: records.filter((record) => !record.archived).map((record) => record.id),
      });
  const skippedRecords: SkippedHubspotRecord[] = [];
  let upsertCount = 0;
  let deactivatedCount = 0;

  for (const record of records) {
    if (record.archived) {
      const archivedCampaign = await withOwnedObjectSyncMutation(input.lease, async (tx) => {
        const existing = await tx.campaign.findFirst({
          where: {
            OR: [
              {
                hubspotPortalId: input.lease.hubspotPortalId,
                hubspotObjectType: input.config.campaign.objectType,
                hubspotObjectId: record.id,
              },
              {
                hubspotPortalId: null,
                hubspotObjectType: input.config.campaign.objectType,
                hubspotObjectId: record.id,
              },
            ],
          },
          select: { id: true, isActive: true },
        });

        if (!existing) {
          return null;
        }

        await tx.campaign.update({
          where: { id: existing.id },
          data: {
            isActive: false,
            hubspotPortalId: input.lease.hubspotPortalId,
            hubspotArchived: true,
            hubspotSyncedAt: input.now,
            hubspotRawPayload: toJsonValue(record),
            status: getRecordProperty(record, input.config.campaign.statusProperty),
          },
        });
        return existing;
      });

      if (archivedCampaign) {
        deactivatedCount += archivedCampaign.isActive ? 1 : 0;
      }

      continue;
    }

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
      const persistCampaign = (legacyCompatible: boolean) =>
        withOwnedObjectSyncMutation(input.lease, async (tx) => {
          const market = marketName
            ? await tx.market.upsert({
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
          const existing = await tx.campaign.findFirst({
            where: {
              OR: [
                {
                  hubspotPortalId: input.lease.hubspotPortalId,
                  hubspotObjectType: input.config.campaign.objectType,
                  hubspotObjectId: record.id,
                },
                {
                  hubspotPortalId: null,
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
            status: getRecordProperty(record, input.config.campaign.statusProperty),
            isActive,
            hubspotPortalId: input.lease.hubspotPortalId,
            hubspotObjectId: record.id,
            hubspotObjectType: input.config.campaign.objectType,
            hubspotArchived: record.archived,
            hubspotSyncedAt: input.now,
            hubspotRawPayload: toJsonValue(record),
          };

          if (existing) {
            await tx.campaign.update({
              where: {
                id: existing.id,
              },
              data: legacyCompatible ? toLegacyCompatibleCampaignUpdateData(data) : data,
            });
          } else {
            if (legacyCompatible) {
              throw new ServiceError(
                "HUBSPOT_OBJECT_SYNC_CAMPAIGN_SCHEMA_INCOMPATIBLE",
                500,
                `HubSpot campaign object ${record.id} omitted client, market, month, or year values that are still required by the local campaigns table`,
              );
            }

            await tx.campaign.create({
              data,
            });
          }

          return {
            wasActive: existing?.isActive ?? true,
          };
        });

      let persistedCampaign: { wasActive: boolean };

      try {
        persistedCampaign = await persistCampaign(false);
      } catch (error) {
        const hasPotentialLegacyNulls =
          clientId === null || marketName === null || month === null || year === null;

        if (!hasPrismaErrorCode(error, "P2011") || !hasPotentialLegacyNulls) {
          throw error;
        }

        persistedCampaign = await persistCampaign(true);
      }

      upsertCount += 1;

      if (persistedCampaign.wasActive && !isActive) {
        deactivatedCount += 1;
      }

    } catch (error) {
      if (!isSkippableCampaignRecordError(error)) {
        throw error;
      }

      skippedRecords.push({
        objectId: record.id,
        reason: formatErrorMessage(error),
      });
    }
  }

  const skippedWarning = formatSkippedHubspotRecords(skippedRecords);

  return {
    upsertCount,
    deactivatedCount,
    warnings: skippedWarning ? [skippedWarning] : [],
  };
}

async function performHubspotObjectSync(input: {
  syncRunId: string;
  leaseOwner: string;
  config: HubspotObjectSyncConfig;
  requestedByUserId: string;
  hubspotPortalId: string;
  mode: PrismaHubspotObjectSyncMode;
  clientHighWaterMark: Date | null;
  campaignHighWaterMark: Date | null;
  now: Date;
}): Promise<SyncCounts> {
  const lease: ObjectSyncLeaseContext = {
    syncRunId: input.syncRunId,
    hubspotPortalId: input.hubspotPortalId,
    leaseOwner: input.leaseOwner,
  };
  const clientResult = await syncClients({
    lease,
    config: input.config,
    mode: input.mode,
    highWaterMark: input.clientHighWaterMark,
    now: input.now,
  });
  const campaignResult = await syncCampaigns({
    lease,
    config: input.config,
    mode: input.mode,
    highWaterMark: input.campaignHighWaterMark,
    clients: clientResult.syncedClients,
    now: input.now,
  });
  const ownerCount = await syncHubspotOwners({
    lease,
    now: input.now,
  });
  const pipelineCounts = await syncHubspotPipelines({
    lease,
    now: input.now,
  });
  const associationResult = await syncHubspotAssociationDefinitions({
    lease,
    config: input.config,
    now: input.now,
  });
  await syncHubspotDropdownValues({
    actorUserId: input.requestedByUserId,
    hubspotPortalId: input.hubspotPortalId,
    activationObjectType: input.config.activationObjectType,
    now: input.now,
    withMutationTransaction: (mutation) =>
      withOwnedObjectSyncMutation(lease, mutation),
  });

  const collaborationSnapshot = await loadHubspotCollaborationSnapshot({
    hubspotPortalId: input.hubspotPortalId,
    config: input.config.collaboration,
  });
  const collaborationResult = await withOwnedObjectSyncMutation(lease, (tx) =>
    persistHubspotCollaborationSnapshot({
      tx,
      hubspotPortalId: input.hubspotPortalId,
      config: input.config.collaboration,
      snapshot: collaborationSnapshot,
      observedAt: input.now,
    }),
  );

  const warnings = [...campaignResult.warnings, ...associationResult.warnings];
  const cursorCounts = {
    clients: clientResult.upsertCount,
    campaigns: campaignResult.upsertCount,
    owners: ownerCount,
    pipelines: pipelineCounts.pipelineCount,
    stages: pipelineCounts.stageCount,
    associations: associationResult.count,
  };
  await withOwnedObjectSyncMutation(lease, async (tx) => {
    for (const objectType of [input.config.client.objectType, input.config.campaign.objectType]) {
      const updatedCursor = await tx.hubspotSyncCursor.updateMany({
        where: {
          hubspotPortalId: input.hubspotPortalId,
          objectType,
          leaseOwner: input.leaseOwner,
        },
        data: {
          highWaterMark: input.now,
          lastAttemptAt: input.now,
          lastSuccessfulSyncAt: input.now,
          ...(input.mode === PrismaHubspotObjectSyncMode.FULL
            ? { lastFullReconciliationAt: input.now }
            : {}),
          counts: toJsonValue(cursorCounts),
          warnings: toJsonValue(warnings),
          lastError: null,
          leaseExpiresAt: new Date(Date.now() + SYNC_LEASE_MS),
        },
      });

      if (updatedCursor.count === 0) {
        throw createObjectSyncLeaseLostError(input.syncRunId);
      }
    }

    const updatedPortal = await tx.hubspotPortal.updateMany({
      where: {
        id: input.hubspotPortalId,
        objectSyncLeaseOwner: input.leaseOwner,
      },
      data: {
        lastReferenceSyncAt: input.now,
        lastObjectSyncAt: input.now,
      },
    });

    if (updatedPortal.count === 0) {
      throw createObjectSyncLeaseLostError(input.syncRunId);
    }
  });

  return {
    clientUpsertCount: clientResult.upsertCount,
    campaignUpsertCount: campaignResult.upsertCount,
    dealMirrorUpsertCount: collaborationResult.dealMirrorUpsertCount,
    activationMirrorUpsertCount: collaborationResult.activationMirrorUpsertCount,
    deactivatedCount: clientResult.deactivatedCount + campaignResult.deactivatedCount,
    warnings,
    highWaterMark: input.now,
  };
}

async function createHubspotObjectSyncRunForUser(input: {
  requestedByUserId: string;
  source: "manual" | "scheduled";
}): Promise<HubspotObjectSyncRun> {
  let syncRunId = "";
  let jobRequestedByUserId = input.requestedByUserId;
  let created = false;
  const mode =
    input.source === "scheduled"
      ? PrismaHubspotObjectSyncMode.FULL
      : PrismaHubspotObjectSyncMode.INCREMENTAL;

  await withDbTransaction(async (tx) => {
    const syncRunDelegate = getHubspotObjectSyncRunDelegate(
      tx as unknown as HubspotObjectSyncRunAccessor,
    );
    const active = await syncRunDelegate.findFirst({
      where: {
        status: {
          in: [
            PrismaHubspotObjectSyncRunStatus.QUEUED,
            PrismaHubspotObjectSyncRunStatus.RUNNING,
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        requestedByUserId: true,
      },
    });

    if (active) {
      syncRunId = active.id;
      jobRequestedByUserId = active.requestedByUserId;
      return;
    }

    const run = await syncRunDelegate.create({
      data: {
        requestedByUserId: input.requestedByUserId,
        mode,
        fullReconciliation: mode === PrismaHubspotObjectSyncMode.FULL,
        objectTypes: toJsonValue(OBJECT_TYPES),
      },
      select: {
        id: true,
      },
    });

    syncRunId = run.id;
    created = true;

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "hubspot_object_sync.requested",
        entityType: "hubspot_object_sync_run",
        entityId: run.id,
        metadata: toJsonValue({
          objectTypes: OBJECT_TYPES,
          source: input.source,
          mode:
            mode === PrismaHubspotObjectSyncMode.FULL ? "full" : "incremental",
        }),
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  try {
    await enqueueHubspotObjectSyncJob({
      syncRunId,
      requestedByUserId: jobRequestedByUserId,
    });
  } catch (error) {
    if (created) {
      const message = `Failed to enqueue HubSpot object sync: ${formatErrorMessage(error)}`;
      const completedAt = new Date();

      await withDbTransaction(async (tx) => {
        const syncRunDelegate = getHubspotObjectSyncRunDelegate(
          tx as unknown as HubspotObjectSyncRunAccessor,
        );
        const failed = await syncRunDelegate.updateMany({
          where: {
            id: syncRunId,
            status: PrismaHubspotObjectSyncRunStatus.QUEUED,
          },
          data: {
            status: PrismaHubspotObjectSyncRunStatus.FAILED,
            completedAt,
            lastError: message,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });

        if (failed.count > 0) {
          await tx.auditEvent.create({
            data: {
              actorUserId: input.requestedByUserId,
              action: "hubspot_object_sync.failed",
              entityType: "hubspot_object_sync_run",
              entityId: syncRunId,
              metadata: toJsonValue({
                lastError: message,
                phase: "enqueue",
                source: input.source,
              }),
            },
          });
        }
      });
    }

    throw error;
  }

  return loadSyncRun(syncRunId);
}

export async function createHubspotObjectSyncRun(input: {
  requestedByUserId: string;
}): Promise<HubspotObjectSyncRun> {
  await getAdminUser(input.requestedByUserId);

  return createHubspotObjectSyncRunForUser({
    requestedByUserId: input.requestedByUserId,
    source: "manual",
  });
}

export async function createScheduledHubspotObjectSyncRun(): Promise<HubspotObjectSyncRun> {
  const requestedByUserId = await getScheduledSyncRequesterUserId();

  return createHubspotObjectSyncRunForUser({
    requestedByUserId,
    source: "scheduled",
  });
}

export async function listHubspotObjectSyncRuns(input: {
  requestedByUserId: string;
  limit?: number;
}): Promise<ListHubspotObjectSyncRunsResponse> {
  await getAdminUser(input.requestedByUserId);

  const syncRunDelegate = getHubspotObjectSyncRunDelegate();
  const runs = await syncRunDelegate.findMany({
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
      mode: true,
      leaseExpiresAt: true,
    },
  });

  if (!run || run.requestedByUserId !== input.requestedByUserId) {
    throw new ServiceError(
      "HUBSPOT_OBJECT_SYNC_RUN_NOT_FOUND",
      404,
      "HubSpot object sync run not found",
    );
  }

  if (run.status === PrismaHubspotObjectSyncRunStatus.COMPLETED) {
    return loadSyncRun(run.id);
  }

  const claimStartedAt = new Date();

  if (
    run.status === PrismaHubspotObjectSyncRunStatus.RUNNING &&
    run.leaseExpiresAt &&
    run.leaseExpiresAt > claimStartedAt
  ) {
    return loadSyncRun(run.id);
  }

  const leaseOwner = `hubspot-object-sync:${run.id}:${randomUUID()}`;
  const leaseExpiresAt = new Date(claimStartedAt.getTime() + SYNC_LEASE_MS);

  const claimed = await syncRunDelegate.updateMany({
    where: {
      id: run.id,
      OR: [
        {
          status: {
            in: [PrismaHubspotObjectSyncRunStatus.QUEUED, PrismaHubspotObjectSyncRunStatus.FAILED],
          },
        },
        {
          status: PrismaHubspotObjectSyncRunStatus.RUNNING,
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: claimStartedAt } }],
        },
      ],
    },
    data: {
      status: PrismaHubspotObjectSyncRunStatus.RUNNING,
      startedAt: claimStartedAt,
      completedAt: null,
      lastError: null,
      clientUpsertCount: 0,
      campaignUpsertCount: 0,
      dealMirrorUpsertCount: 0,
      activationMirrorUpsertCount: 0,
      deactivatedCount: 0,
      warningCount: 0,
      warnings: toJsonValue([]),
      leaseOwner,
      leaseExpiresAt,
    },
  });

  if (claimed.count === 0) {
    return loadSyncRun(run.id);
  }

  const heartbeat = startObjectSyncLeaseHeartbeat({
    syncRunId: run.id,
    leaseOwner,
  });
  let portal: { id: string; portalId: string } | null = null;
  let portalLeaseAcquired = false;

  try {
    const config = loadHubspotObjectSyncConfig();
    const portalIdentity = await loadVerifiedHubspotPortalIdentity();
    const portalLeaseStartedAt = new Date();
    const portalLeaseExpiresAt = new Date(portalLeaseStartedAt.getTime() + SYNC_LEASE_MS);
    const portalClaimResult = await withDbTransaction(async (tx) => {
      await renewObjectSyncRunLeaseInTransaction(
        tx,
        {
          syncRunId: run.id,
          leaseOwner,
        },
        portalLeaseExpiresAt,
      );

      const claimedPortal = await tx.hubspotPortal.upsert({
        where: {
          portalId: portalIdentity.portalId,
        },
        create: {
          portalId: portalIdentity.portalId,
          displayName: portalIdentity.displayName,
          objectSyncLeaseOwner: leaseOwner,
          objectSyncLeaseExpiresAt: portalLeaseExpiresAt,
        },
        update: {},
        select: {
          id: true,
          portalId: true,
        },
      });

      const portalClaim = await tx.hubspotPortal.updateMany({
        where: {
          id: claimedPortal.id,
          OR: [
            { objectSyncLeaseOwner: leaseOwner },
            { objectSyncLeaseOwner: null },
            { objectSyncLeaseExpiresAt: null },
            { objectSyncLeaseExpiresAt: { lte: portalLeaseStartedAt } },
          ],
        },
        data: {
          ...(portalIdentity.displayName
            ? { displayName: portalIdentity.displayName }
            : {}),
          objectSyncLeaseOwner: leaseOwner,
          objectSyncLeaseExpiresAt: portalLeaseExpiresAt,
        },
      });

      return {
        portal: claimedPortal,
        count: portalClaim.count,
      };
    });
    portal = portalClaimResult.portal;
    const claimedPortal = portalClaimResult.portal;

    if (portalClaimResult.count === 0) {
      const activeLease = await prisma.hubspotPortal.findUnique({
        where: { id: claimedPortal.id },
        select: {
          objectSyncLeaseOwner: true,
          objectSyncLeaseExpiresAt: true,
        },
      });

      throw new ServiceError(
        "HUBSPOT_OBJECT_SYNC_OVERLAP",
        409,
        activeLease?.objectSyncLeaseOwner
          ? `HubSpot portal ${claimedPortal.portalId} is already being synchronized by ${activeLease.objectSyncLeaseOwner}`
          : `HubSpot portal ${claimedPortal.portalId} is already being synchronized`,
      );
    }

    portalLeaseAcquired = true;
    heartbeat.attachPortal(claimedPortal.id);
    const cursors = await prisma.hubspotSyncCursor.findMany({
      where: {
        hubspotPortalId: claimedPortal.id,
        objectType: {
          in: [config.client.objectType, config.campaign.objectType],
        },
      },
      select: {
        objectType: true,
        highWaterMark: true,
      },
    });
    const highWaterByObjectType = new Map(
      cursors.map((cursor) => [cursor.objectType, cursor.highWaterMark]),
    );
    const requestedIncremental = run.mode === PrismaHubspotObjectSyncMode.INCREMENTAL;
    const hasBothCursors =
      highWaterByObjectType.get(config.client.objectType) instanceof Date &&
      highWaterByObjectType.get(config.campaign.objectType) instanceof Date;
    const effectiveMode =
      requestedIncremental && hasBothCursors
        ? PrismaHubspotObjectSyncMode.INCREMENTAL
        : PrismaHubspotObjectSyncMode.FULL;
    const highWaterMark = new Date();

    await withDbTransaction(async (tx) => {
      const transactionSyncRunDelegate = getHubspotObjectSyncRunDelegate(
        tx as unknown as HubspotObjectSyncRunAccessor,
      );
      const updatedRun = await transactionSyncRunDelegate.updateMany({
        where: {
          id: run.id,
          status: PrismaHubspotObjectSyncRunStatus.RUNNING,
          leaseOwner,
        },
        data: {
          hubspotPortalId: claimedPortal.id,
          mode: effectiveMode,
          fullReconciliation: effectiveMode === PrismaHubspotObjectSyncMode.FULL,
          highWaterMark,
          leaseExpiresAt: portalLeaseExpiresAt,
        },
      });

      if (updatedRun.count === 0) {
        throw createObjectSyncLeaseLostError(run.id);
      }

      const updatedPortal = await tx.hubspotPortal.updateMany({
        where: {
          id: claimedPortal.id,
          objectSyncLeaseOwner: leaseOwner,
        },
        data: {
          objectSyncLeaseExpiresAt: portalLeaseExpiresAt,
        },
      });

      if (updatedPortal.count === 0) {
        throw createObjectSyncLeaseLostError(run.id);
      }

      for (const objectType of [config.client.objectType, config.campaign.objectType]) {
        await tx.hubspotSyncCursor.upsert({
          where: {
            hubspotPortalId_objectType: {
              hubspotPortalId: claimedPortal.id,
              objectType,
            },
          },
          create: {
            hubspotPortalId: claimedPortal.id,
            objectType,
            lastAttemptAt: claimStartedAt,
            leaseOwner,
            leaseExpiresAt: portalLeaseExpiresAt,
          },
          update: {
            lastAttemptAt: claimStartedAt,
            leaseOwner,
            leaseExpiresAt: portalLeaseExpiresAt,
            lastError: null,
          },
        });
      }
    });
    await heartbeat.renewNow();

    const counts = await performHubspotObjectSync({
      syncRunId: run.id,
      leaseOwner,
      config,
      requestedByUserId: input.requestedByUserId,
      hubspotPortalId: claimedPortal.id,
      mode: effectiveMode,
      clientHighWaterMark:
        highWaterByObjectType.get(config.client.objectType) ?? null,
      campaignHighWaterMark:
        highWaterByObjectType.get(config.campaign.objectType) ?? null,
      now: highWaterMark,
    });
    await heartbeat.stop();

    const completed = await syncRunDelegate.updateMany({
      where: {
        id: run.id,
        status: PrismaHubspotObjectSyncRunStatus.RUNNING,
        leaseOwner,
      },
      data: {
        status: PrismaHubspotObjectSyncRunStatus.COMPLETED,
        clientUpsertCount: counts.clientUpsertCount,
        campaignUpsertCount: counts.campaignUpsertCount,
        dealMirrorUpsertCount: counts.dealMirrorUpsertCount,
        activationMirrorUpsertCount: counts.activationMirrorUpsertCount,
        deactivatedCount: counts.deactivatedCount,
        warningCount: counts.warnings.length,
        warnings: toJsonValue(counts.warnings),
        highWaterMark: counts.highWaterMark,
        completedAt: new Date(),
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    if (completed.count === 0) {
      throw createObjectSyncLeaseLostError(run.id);
    }

    await prisma.hubspotSyncCursor.updateMany({
      where: {
        hubspotPortalId: claimedPortal.id,
        leaseOwner,
      },
      data: {
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    await recordAuditEvent({
      actorUserId: input.requestedByUserId,
      action: "hubspot_object_sync.completed",
      entityType: "hubspot_object_sync_run",
      entityId: run.id,
      metadata: {
        clientUpsertCount: counts.clientUpsertCount,
        campaignUpsertCount: counts.campaignUpsertCount,
        dealMirrorUpsertCount: counts.dealMirrorUpsertCount,
        activationMirrorUpsertCount: counts.activationMirrorUpsertCount,
        deactivatedCount: counts.deactivatedCount,
        warningCount: counts.warnings.length,
        warnings: counts.warnings,
        highWaterMark: counts.highWaterMark.toISOString(),
        portalId: claimedPortal.portalId,
      },
    });
  } catch (error) {
    let terminalError = error;

    try {
      await heartbeat.stop();
    } catch (heartbeatError) {
      terminalError = heartbeatError;
    }

    const message = formatErrorMessage(terminalError);
    const failed = await syncRunDelegate.updateMany({
      where: {
        id: run.id,
        status: PrismaHubspotObjectSyncRunStatus.RUNNING,
        leaseOwner,
      },
      data: {
        status: PrismaHubspotObjectSyncRunStatus.FAILED,
        completedAt: new Date(),
        lastError: message,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    if (failed.count > 0) {
      if (portal) {
        await prisma.hubspotSyncCursor.updateMany({
          where: {
            hubspotPortalId: portal.id,
            leaseOwner,
          },
          data: {
            lastError: message,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
      }

      await recordAuditEvent({
        actorUserId: input.requestedByUserId,
        action: "hubspot_object_sync.failed",
        entityType: "hubspot_object_sync_run",
        entityId: run.id,
        metadata: {
          lastError: message,
        },
      });
    }

    throw terminalError;
  } finally {
    if (portal && portalLeaseAcquired) {
      await prisma.hubspotPortal.updateMany({
        where: {
          id: portal.id,
          objectSyncLeaseOwner: leaseOwner,
        },
        data: {
          objectSyncLeaseOwner: null,
          objectSyncLeaseExpiresAt: null,
        },
      });
    }
  }

  return loadSyncRun(run.id);
}
