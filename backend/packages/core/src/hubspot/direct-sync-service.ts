import { randomUUID } from "node:crypto";

import {
  DropdownValueFieldKey as PrismaDropdownValueFieldKey,
  HubspotAssociationStatus as PrismaHubspotAssociationStatus,
  HubspotExternalDeliveryStatus as PrismaHubspotExternalDeliveryStatus,
  HubspotImportBatchRowStatus as PrismaHubspotImportBatchRowStatus,
  HubspotImportBatchStatus as PrismaHubspotImportBatchStatus,
  HubspotPortalHealthStatus as PrismaHubspotPortalHealthStatus,
  HubspotPushBatchRowStatus as PrismaHubspotPushBatchRowStatus,
  type Prisma,
} from "@prisma/client";
import { HUBSPOT_IMPORT_HEADER } from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  HubspotError,
  batchUpdateHubspotContacts,
  batchUpsertHubspotContacts,
  batchUpsertHubspotDeals,
  createHubspotAssociations,
  isHubspotError,
  loadHubspotConfig,
  type HubspotAssociationCategory,
  type HubspotAssociationBatchError,
  type HubspotBatchUpsertOutcome,
  type HubspotBatchUpsertFailure,
  type HubspotConfig,
} from "@scouting-platform/integrations";

import { ServiceError } from "../errors";
import {
  buildHubspotDealExternalKey,
  buildHubspotOutboundProperties,
  buildHubspotPreparationHash,
  resolveHubspotInternalValue,
  resolveHubspotOwnerByEmail,
} from "./direct-sync-domain";
import { computeInfluencerSizeTier } from "./influencer-size";
import { enqueueHubspotImportJob } from "./queue";

const PHASE_LEASE_MS = 5 * 60_000;
const PHASE_CLAIM_RECHECK_MAX_SECONDS = 30;
const MAX_PHASE_RETRIES = 5;
const HEALTH_CHECK_FRESHNESS_MS = 24 * 60 * 60_000;

export const HUBSPOT_DIRECT_SYNC_GRAPH_VERSION = 2 as const;

type CsvPayload = {
  channelTitle: string;
  csv: Record<(typeof HUBSPOT_IMPORT_HEADER)[number], string>;
  providerSnapshot: {
    youtubeChannelId: string;
    youtubeHandle: string | null;
    youtubeUrl: string;
    subscriberCount: string | null;
    youtubeFollowers: string | null;
    youtubeVideoMedianViews: string | null;
    youtubeShortsMedianViews: string | null;
    youtubeEngagementRate: number | null;
  };
};

type AssociationReference = Readonly<{
  associationCategory: HubspotAssociationCategory;
  associationTypeId: number;
}>;

type DirectSyncSnapshot = Readonly<{
  version: 1 | typeof HUBSPOT_DIRECT_SYNC_GRAPH_VERSION;
  portalDatabaseId: string;
  portalId: string;
  contactUniqueIdProperty: string;
  dealUniqueIdProperty: string;
  run: {
    id: string;
    campaign: {
      id: string;
      hubspotObjectId: string;
      hubspotObjectType: string;
      client: {
        id: string;
        hubspotObjectId: string;
        hubspotObjectType: string;
      };
    };
  };
  ownerId: string;
  pipelineId: string;
  stageId: string;
  dealProperties: Readonly<Record<string, string>>;
  contactToDeal: AssociationReference;
  dealToCampaign: AssociationReference;
  dealToClient: AssociationReference | null;
  campaignToClient: AssociationReference;
  dropdownReferences: Readonly<Record<DirectDropdownKey, readonly DropdownReference[]>>;
}>;

type DirectContext = DirectSyncSnapshot & Readonly<{ config: HubspotConfig }>;

type PhaseLease = Readonly<{
  owner: string;
}>;

type DirectDropdownKey =
  | "currency"
  | "dealType"
  | "activationType"
  | "influencerType"
  | "influencerVertical"
  | "countryRegion"
  | "language";

type DropdownReference = Readonly<{ label: string; internalValue: string }>;

const DIRECT_DROPDOWN_KEYS: Readonly<Record<PrismaDropdownValueFieldKey, DirectDropdownKey>> = {
  [PrismaDropdownValueFieldKey.CURRENCY]: "currency",
  [PrismaDropdownValueFieldKey.DEAL_TYPE]: "dealType",
  [PrismaDropdownValueFieldKey.ACTIVATION_TYPE]: "activationType",
  [PrismaDropdownValueFieldKey.INFLUENCER_TYPE]: "influencerType",
  [PrismaDropdownValueFieldKey.INFLUENCER_VERTICAL]: "influencerVertical",
  [PrismaDropdownValueFieldKey.COUNTRY_REGION]: "countryRegion",
  [PrismaDropdownValueFieldKey.LANGUAGE]: "language",
};

function emptyDropdownReferences(): Record<DirectDropdownKey, DropdownReference[]> {
  return {
    currency: [],
    dealType: [],
    activationType: [],
    influencerType: [],
    influencerVertical: [],
    countryRegion: [],
    language: [],
  };
}

function resolvePreparedReference(input: {
  value: string;
  fieldLabel: string;
  references: readonly DropdownReference[];
}): string | null {
  if (!input.value.trim()) {
    return null;
  }
  const resolved = resolveHubspotInternalValue({
    displayOrInternalValue: input.value,
    references: input.references,
  });
  if (!resolved) {
    throw new ServiceError(
      "HUBSPOT_REFERENCE_VALUE_UNRESOLVED",
      409,
      `${input.fieldLabel} no longer resolves to one synchronized HubSpot internal value`,
    );
  }
  return resolved;
}

function consistentPreparedValue(rows: readonly CsvPayload[], field: (typeof HUBSPOT_IMPORT_HEADER)[number]): string {
  const values = [...new Set(rows.map((row) => row.csv[field].trim()).filter(Boolean))];
  if (values.length > 1) {
    throw new ServiceError(
      "HUBSPOT_DEAL_VALUE_AMBIGUOUS",
      409,
      `${field} must be consistent across every contact in a one-deal sync`,
    );
  }
  return values[0] ?? "";
}

function formatError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function configServiceError(error: unknown): ServiceError {
  return new ServiceError(
    "HUBSPOT_DIRECT_SYNC_CONFIGURATION_INVALID",
    409,
    error instanceof Error ? error.message : "HubSpot direct sync configuration is invalid",
  );
}

function loadDirectConfig(): HubspotConfig {
  try {
    return loadHubspotConfig();
  } catch (error) {
    throw configServiceError(error);
  }
}

function isJsonObject(
  value: Prisma.JsonValue | null | undefined,
): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function requiredSnapshotString(
  value: Prisma.JsonObject,
  key: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
      500,
      `The durable HubSpot direct-sync snapshot is missing ${key}`,
    );
  }
  return candidate;
}

function parseSnapshotAssociation(value: Prisma.JsonValue | undefined): AssociationReference {
  if (!isJsonObject(value)) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
      500,
      "The durable HubSpot association snapshot is invalid",
    );
  }
  const categoryValue = value.associationCategory;
  const category = typeof categoryValue === "string"
    ? associationCategory(categoryValue)
    : null;
  if (
    !category
    || typeof value.associationTypeId !== "number"
    || !Number.isInteger(value.associationTypeId)
    || value.associationTypeId <= 0
  ) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
      500,
      "The durable HubSpot association snapshot is invalid",
    );
  }
  return {
    associationCategory: category,
    associationTypeId: value.associationTypeId,
  };
}

function parseSnapshotDropdownReferences(
  value: Prisma.JsonValue | undefined,
): Record<DirectDropdownKey, DropdownReference[]> {
  if (!isJsonObject(value)) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
      500,
      "The durable HubSpot dropdown snapshot is invalid",
    );
  }
  const parsed = emptyDropdownReferences();
  for (const key of Object.keys(parsed) as DirectDropdownKey[]) {
    const entries = value[key];
    if (!Array.isArray(entries)) {
      throw new ServiceError(
        "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
        500,
        `The durable HubSpot dropdown snapshot is missing ${key}`,
      );
    }
    parsed[key] = entries.map((entry) => {
      if (!isJsonObject(entry)) {
        throw new ServiceError(
          "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
          500,
          `The durable HubSpot dropdown snapshot contains an invalid ${key} entry`,
        );
      }
      return {
        label: requiredSnapshotString(entry, "label"),
        internalValue: requiredSnapshotString(entry, "internalValue"),
      };
    });
  }
  return parsed;
}

function parseDirectSyncSnapshot(value: Prisma.JsonValue | null): DirectSyncSnapshot {
  if (
    !isJsonObject(value)
    || (value.version !== 1 && value.version !== HUBSPOT_DIRECT_SYNC_GRAPH_VERSION)
    || !isJsonObject(value.run)
  ) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
      500,
      "The durable HubSpot direct-sync snapshot is missing or invalid",
    );
  }
  const run = value.run;
  const campaignValue = run.campaign;
  if (!isJsonObject(campaignValue)) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
      500,
      "The durable HubSpot run-reference snapshot is invalid",
    );
  }
  const campaign = campaignValue;
  const clientValue = campaign.client;
  if (!isJsonObject(clientValue)) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
      500,
      "The durable HubSpot client-reference snapshot is invalid",
    );
  }
  const client = clientValue;
  if (!isJsonObject(value.dealProperties)) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
      500,
      "The durable HubSpot deal snapshot is invalid",
    );
  }
  const dealProperties: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value.dealProperties)) {
    if (typeof candidate !== "string") {
      throw new ServiceError(
        "HUBSPOT_DIRECT_SNAPSHOT_INVALID",
        500,
        "The durable HubSpot deal snapshot contains an invalid property",
      );
    }
    dealProperties[key] = candidate;
  }

  return {
    version: value.version,
    portalDatabaseId: requiredSnapshotString(value, "portalDatabaseId"),
    portalId: requiredSnapshotString(value, "portalId"),
    contactUniqueIdProperty: requiredSnapshotString(value, "contactUniqueIdProperty"),
    dealUniqueIdProperty: requiredSnapshotString(value, "dealUniqueIdProperty"),
    run: {
      id: requiredSnapshotString(run, "id"),
      campaign: {
        id: requiredSnapshotString(campaign, "id"),
        hubspotObjectId: requiredSnapshotString(campaign, "hubspotObjectId"),
        hubspotObjectType: requiredSnapshotString(campaign, "hubspotObjectType"),
        client: {
          id: requiredSnapshotString(client, "id"),
          hubspotObjectId: requiredSnapshotString(client, "hubspotObjectId"),
          hubspotObjectType: requiredSnapshotString(client, "hubspotObjectType"),
        },
      },
    },
    ownerId: requiredSnapshotString(value, "ownerId"),
    pipelineId: requiredSnapshotString(value, "pipelineId"),
    stageId: requiredSnapshotString(value, "stageId"),
    dealProperties,
    contactToDeal: parseSnapshotAssociation(value.contactToDeal),
    dealToCampaign: parseSnapshotAssociation(value.dealToCampaign),
    dealToClient: value.version === 1
      ? null
      : parseSnapshotAssociation(value.dealToClient),
    campaignToClient: parseSnapshotAssociation(value.campaignToClient),
    dropdownReferences: parseSnapshotDropdownReferences(value.dropdownReferences),
  };
}

function parseCsvPayload(payload: Prisma.JsonValue): CsvPayload {
  if (!isJsonObject(payload)) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_PAYLOAD_INVALID",
      500,
      "HubSpot import row payload is invalid",
    );
  }
  const csvPayload = payload.csv;
  if (!isJsonObject(csvPayload)) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_PAYLOAD_INVALID",
      500,
      "HubSpot import row payload is invalid",
    );
  }
  const csv = {} as Record<(typeof HUBSPOT_IMPORT_HEADER)[number], string>;
  for (const field of HUBSPOT_IMPORT_HEADER) {
    csv[field] = typeof csvPayload[field] === "string" ? csvPayload[field] : "";
  }
  const rawSnapshot = isJsonObject(payload.providerSnapshot)
    ? payload.providerSnapshot
    : null;
  if (!rawSnapshot) {
    throw new ServiceError(
      "HUBSPOT_PROVIDER_SNAPSHOT_MISSING",
      500,
      "A direct HubSpot row is missing its durable provider snapshot",
    );
  }
  const stringOrNull = (value: Prisma.JsonValue | undefined): string | null =>
    typeof value === "string" && value.trim() ? value : null;
  const youtubeChannelId = stringOrNull(rawSnapshot.youtubeChannelId);
  const youtubeUrl = stringOrNull(rawSnapshot.youtubeUrl);
  if (!youtubeChannelId || !youtubeUrl) {
    throw new ServiceError(
      "HUBSPOT_PROVIDER_SNAPSHOT_INVALID",
      500,
      "A direct HubSpot row has an invalid durable provider snapshot",
    );
  }
  return {
    channelTitle: typeof payload.channelTitle === "string" ? payload.channelTitle : "",
    csv,
    providerSnapshot: {
      youtubeChannelId,
      youtubeHandle: stringOrNull(rawSnapshot.youtubeHandle),
      youtubeUrl,
      subscriberCount: stringOrNull(rawSnapshot.subscriberCount),
      youtubeFollowers: stringOrNull(rawSnapshot.youtubeFollowers),
      youtubeVideoMedianViews: stringOrNull(rawSnapshot.youtubeVideoMedianViews),
      youtubeShortsMedianViews: stringOrNull(rawSnapshot.youtubeShortsMedianViews),
      youtubeEngagementRate:
        typeof rawSnapshot.youtubeEngagementRate === "number"
          ? rawSnapshot.youtubeEngagementRate
          : null,
    },
  };
}

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll(`"`, `""`)}"` : value;
}

function buildCsvContent(rows: readonly CsvPayload[]): string {
  return [
    HUBSPOT_IMPORT_HEADER.join(","),
    ...rows.map((row) =>
      HUBSPOT_IMPORT_HEADER.map((field) => escapeCsvCell(row.csv[field])).join(","),
    ),
  ].join("\n");
}

function associationCategory(value: string): HubspotAssociationCategory | null {
  return ["HUBSPOT_DEFINED", "USER_DEFINED", "INTEGRATOR_DEFINED"].includes(value)
    ? (value as HubspotAssociationCategory)
    : null;
}

function chooseAssociation(
  definitions: readonly {
    associationCategory: string;
    associationTypeId: number;
    label: string | null;
  }[],
  options: {
    preferredLabel?: string;
    configuredTypeId?: number | null;
    relationshipLabel?: string;
  },
): AssociationReference {
  const configured = options.configuredTypeId
    ? definitions.filter((item) => item.associationTypeId === options.configuredTypeId)
    : [];
  const labeled = options.preferredLabel
    ? definitions.filter(
        (item) => item.label?.trim().toLowerCase() === options.preferredLabel?.toLowerCase(),
      )
    : [];
  const defaults = definitions.filter((item) => item.label === null);
  const candidates = options.configuredTypeId != null
    ? configured
    : labeled.length > 0
      ? labeled
      : definitions.length === 1
        ? definitions
        : defaults.length === 1
          ? defaults
          : [];
  const chosen = candidates.length === 1 ? candidates[0] : null;
  const category = chosen ? associationCategory(chosen.associationCategory) : null;

  if (chosen && category) {
    return {
      associationCategory: category,
      associationTypeId: chosen.associationTypeId,
    };
  }

  throw new ServiceError(
    "HUBSPOT_ASSOCIATION_REFERENCE_MISSING",
    409,
    `The required ${options.relationshipLabel ?? "HubSpot association"} type is missing or ambiguous; create or select it in HubSpot, then run Sync from HubSpot`,
  );
}

async function loadDirectContext(
  runId: string,
  preparedRows: readonly CsvPayload[],
): Promise<DirectContext> {
  const config = loadDirectConfig();
  const contactUniqueIdProperty = config.propertyMappings.contactUniqueIdProperty;
  const dealUniqueIdProperty = config.propertyMappings.dealUniqueIdProperty;
  if (!config.featureFlags.directSync) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SYNC_DISABLED",
      409,
      "Direct HubSpot sync is disabled; use Download HubSpot CSV instead",
    );
  }
  if (!config.portalId) {
    throw new ServiceError(
      "HUBSPOT_PORTAL_ID_MISSING",
      409,
      "HUBSPOT_PORTAL_ID is required for direct sync",
    );
  }
  if (!contactUniqueIdProperty) {
    throw new ServiceError(
      "HUBSPOT_CONTACT_UNIQUE_PROPERTY_MISSING",
      409,
      "Configure the provisioned HubSpot contact unique-ID property",
    );
  }
  if (!dealUniqueIdProperty) {
    throw new ServiceError(
      "HUBSPOT_DEAL_UNIQUE_PROPERTY_MISSING",
      409,
      "Configure the provisioned HubSpot deal unique-ID property",
    );
  }

  const portal = await prisma.hubspotPortal.findUnique({
    where: { portalId: config.portalId },
    select: {
      id: true,
      healthStatus: true,
      healthCheckedAt: true,
      owners: {
        where: { archived: false },
        select: { hubspotOwnerId: true, email: true, isActive: true },
      },
      pipelines: {
        where: { objectType: "deals", archived: false },
        select: {
          id: true,
          hubspotPipelineId: true,
          label: true,
          stages: {
            where: { archived: false },
            select: { hubspotStageId: true, label: true },
          },
        },
      },
      dropdownValues: {
        where: { source: "hubspot" },
        select: { fieldKey: true, label: true, value: true, internalValue: true },
      },
    },
  });
  if (!portal || !portal.healthCheckedAt) {
    throw new ServiceError(
      "HUBSPOT_HEALTH_CHECK_REQUIRED",
      409,
      "Run the HubSpot connection health check before enabling direct sync",
    );
  }
  if (Date.now() - portal.healthCheckedAt.getTime() > HEALTH_CHECK_FRESHNESS_MS) {
    throw new ServiceError(
      "HUBSPOT_HEALTH_CHECK_STALE",
      409,
      "The HubSpot connection health check is stale; run it again before direct sync",
    );
  }
  if (portal.healthStatus !== PrismaHubspotPortalHealthStatus.HEALTHY) {
    throw new ServiceError(
      "HUBSPOT_CONNECTION_NOT_READY",
      409,
      "HubSpot connection health is not ready for direct sync",
    );
  }

  const run = await prisma.runRequest.findUnique({
    where: { id: runId },
    select: {
      id: true,
      name: true,
      dealName: true,
      currency: true,
      pipeline: true,
      dealStage: true,
      campaignManagerUser: { select: { email: true } },
      campaign: {
        select: {
          id: true,
          hubspotPortalId: true,
          hubspotObjectId: true,
          hubspotObjectType: true,
          client: {
            select: {
              id: true,
              hubspotPortalId: true,
              hubspotObjectId: true,
              hubspotObjectType: true,
            },
          },
        },
      },
    },
  });
  if (!run) {
    throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
  }
  const campaign = run.campaign;
  const client = campaign?.client;
  if (
    !campaign?.hubspotObjectId
    || !campaign.hubspotObjectType
    || campaign.hubspotPortalId !== portal.id
    || !client?.hubspotObjectId
    || !client.hubspotObjectType
    || client.hubspotPortalId !== portal.id
  ) {
    throw new ServiceError(
      "HUBSPOT_RUN_REFERENCES_MISSING",
      409,
      "The run must reference portal-linked HubSpot campaign and client records",
    );
  }

  const owner = resolveHubspotOwnerByEmail(
    run.campaignManagerUser?.email,
    portal.owners.map((item) => ({
      id: item.hubspotOwnerId,
      email: item.email,
      active: item.isActive,
    })),
  );
  if (owner.status !== "resolved") {
    throw new ServiceError("HUBSPOT_OWNER_UNRESOLVED", 409, owner.message);
  }

  const preparedPipeline = consistentPreparedValue(preparedRows, "Pipeline");
  const requestedPipeline = (preparedPipeline || run.pipeline || "").trim().toLowerCase();
  const pipelines = portal.pipelines.filter(
    (item) =>
      item.hubspotPipelineId.toLowerCase() === requestedPipeline
      || item.label.trim().toLowerCase() === requestedPipeline,
  );
  if (pipelines.length !== 1) {
    throw new ServiceError(
      "HUBSPOT_PIPELINE_UNRESOLVED",
      409,
      "The prepared pipeline does not resolve to one active HubSpot pipeline",
    );
  }
  const pipeline = pipelines[0]!;
  const preparedStage = consistentPreparedValue(preparedRows, "Deal stage");
  const requestedStage = (preparedStage || run.dealStage || "").trim().toLowerCase();
  const stages = pipeline.stages.filter(
    (item) =>
      item.hubspotStageId.toLowerCase() === requestedStage
      || item.label.trim().toLowerCase() === requestedStage,
  );
  if (stages.length !== 1) {
    throw new ServiceError(
      "HUBSPOT_STAGE_UNRESOLVED",
      409,
      "The prepared deal stage does not resolve to one active HubSpot pipeline stage",
    );
  }

  const associationPairs = [
    ["contacts", "deals"],
    ["deals", campaign.hubspotObjectType],
    ["deals", client.hubspotObjectType],
    [campaign.hubspotObjectType, client.hubspotObjectType],
  ] as const;
  const definitions = await prisma.hubspotAssociationDefinition.findMany({
    where: {
      hubspotPortalId: portal.id,
      archived: false,
      OR: associationPairs.map(([fromObjectType, toObjectType]) => ({
        fromObjectType,
        toObjectType,
      })),
    },
    select: {
      fromObjectType: true,
      toObjectType: true,
      associationCategory: true,
      associationTypeId: true,
      label: true,
    },
  });
  const forPair = (fromObjectType: string, toObjectType: string) =>
    definitions.filter(
      (item) => item.fromObjectType === fromObjectType && item.toObjectType === toObjectType,
    );
  const dropdownReferences = emptyDropdownReferences();
  for (const reference of portal.dropdownValues) {
    const internalValue = reference.internalValue?.trim();
    const label = (reference.label ?? reference.value).trim();
    if (internalValue && label) {
      dropdownReferences[DIRECT_DROPDOWN_KEYS[reference.fieldKey]].push({
        label,
        internalValue,
      });
    }
  }

  const contactToDeal = chooseAssociation(forPair("contacts", "deals"), {
    preferredLabel: "Scouted creator",
    relationshipLabel: "Contact → Deal association",
  })!;
  const dealToCampaign = chooseAssociation(
    forPair("deals", campaign.hubspotObjectType),
    {
      configuredTypeId: config.associationMappings.dealCampaignAssociationTypeId,
      relationshipLabel: "Deal → Campaign association",
    },
  )!;
  const dealToClient = chooseAssociation(
    forPair("deals", client.hubspotObjectType),
    {
      configuredTypeId: config.associationMappings.dealClientAssociationTypeId,
      relationshipLabel: "Deal → Client association",
    },
  )!;
  const campaignToClient = chooseAssociation(
    forPair(campaign.hubspotObjectType, client.hubspotObjectType),
    {
      configuredTypeId: config.associationMappings.campaignClientAssociationTypeId,
      relationshipLabel: "Campaign → Client association",
    },
  )!;
  const dealExternalKey = buildHubspotDealExternalKey(run.id);
  const dealProperties = buildHubspotOutboundProperties({
    values: {
      [dealUniqueIdProperty]: dealExternalKey,
      dealname: consistentPreparedValue(preparedRows, "Deal name") || run.dealName || run.name,
      pipeline: pipeline.hubspotPipelineId,
      dealstage: stages[0]!.hubspotStageId,
      hubspot_owner_id: owner.ownerId,
      deal_currency_code: resolvePreparedReference({
        value: consistentPreparedValue(preparedRows, "Currency") || run.currency || "",
        fieldLabel: "Currency",
        references: dropdownReferences.currency,
      }),
      dealtype: resolvePreparedReference({
        value: consistentPreparedValue(preparedRows, "Deal Type"),
        fieldLabel: "Deal Type",
        references: dropdownReferences.dealType,
      }),
      activation_type: resolvePreparedReference({
        value: consistentPreparedValue(preparedRows, "Activation Type"),
        fieldLabel: "Activation Type",
        references: dropdownReferences.activationType,
      }),
    },
  });

  return {
    version: HUBSPOT_DIRECT_SYNC_GRAPH_VERSION,
    config,
    portalDatabaseId: portal.id,
    portalId: config.portalId,
    contactUniqueIdProperty,
    dealUniqueIdProperty,
    run: {
      id: run.id,
      campaign: {
        id: campaign.id,
        hubspotObjectId: campaign.hubspotObjectId,
        hubspotObjectType: campaign.hubspotObjectType,
        client: {
          id: client.id,
          hubspotObjectId: client.hubspotObjectId,
          hubspotObjectType: client.hubspotObjectType,
        },
      },
    },
    ownerId: owner.ownerId,
    pipelineId: pipeline.hubspotPipelineId,
    stageId: stages[0]!.hubspotStageId,
    dealProperties,
    contactToDeal,
    dealToCampaign,
    dealToClient,
    campaignToClient,
    dropdownReferences,
  };
}

export async function getHubspotDirectSyncCreationContext(input: {
  runId: string;
  preparedPayloads: readonly Prisma.JsonValue[];
}): Promise<{
  portalDatabaseId: string;
  portalId: string;
  snapshot: DirectSyncSnapshot;
}> {
  const preparedRows = input.preparedPayloads.map(parseCsvPayload);
  const context = await loadDirectContext(input.runId, preparedRows);
  const { config, ...snapshot } = context;
  void config;
  return {
    portalDatabaseId: context.portalDatabaseId,
    portalId: context.portalId,
    snapshot,
  };
}

function loadPersistedDirectContext(input: {
  snapshotValue: Prisma.JsonValue | null;
  hubspotPortalId: string | null;
  runRequestId: string;
}): DirectContext {
  const config = loadDirectConfig();
  if (!config.featureFlags.directSync) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SYNC_DISABLED",
      409,
      "Direct HubSpot sync is disabled; use Download HubSpot CSV instead",
    );
  }
  const snapshot = parseDirectSyncSnapshot(input.snapshotValue);
  if (
    !config.portalId
    || config.portalId !== snapshot.portalId
    || input.hubspotPortalId !== snapshot.portalDatabaseId
    || input.runRequestId !== snapshot.run.id
  ) {
    throw new ServiceError(
      "HUBSPOT_DIRECT_SNAPSHOT_MISMATCH",
      409,
      "The durable HubSpot direct-sync snapshot does not match the configured portal or run",
    );
  }
  return { ...snapshot, config };
}

async function claimPhase(
  importBatchId: string,
  statuses: readonly PrismaHubspotImportBatchStatus[],
  claimedStatus: PrismaHubspotImportBatchStatus,
): Promise<PhaseLease | null> {
  const now = new Date();
  const owner = randomUUID();
  const claim = await prisma.hubspotImportBatch.updateMany({
    where: {
      id: importBatchId,
      status: { in: [...statuses] },
      AND: [
        { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
        { OR: [{ phaseLeaseExpiresAt: null }, { phaseLeaseExpiresAt: { lte: now } }] },
      ],
    },
    data: {
      status: claimedStatus,
      startedAt: now,
      completedAt: null,
      phaseLeaseOwner: owner,
      phaseLeaseExpiresAt: new Date(now.getTime() + PHASE_LEASE_MS),
      lastError: null,
    },
  });
  return claim.count === 1 ? { owner } : null;
}

async function deferContendedPhase(input: {
  importBatchId: string;
  requestedByUserId: string;
}): Promise<void> {
  const current = await prisma.hubspotImportBatch.findUnique({
    where: { id: input.importBatchId },
    select: {
      requestedByUserId: true,
      status: true,
      nextRetryAt: true,
      phaseLeaseExpiresAt: true,
    },
  });
  if (!current) {
    return;
  }
  if (current.requestedByUserId !== input.requestedByUserId) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_USER_MISMATCH",
      403,
      "HubSpot sync user mismatch",
    );
  }
  if (
    current.status === PrismaHubspotImportBatchStatus.COMPLETED
    || current.status === PrismaHubspotImportBatchStatus.COMPLETED_WITH_ERRORS
    || current.status === PrismaHubspotImportBatchStatus.FAILED
  ) {
    return;
  }

  const now = Date.now();
  const retryDelaySeconds = current.nextRetryAt && current.nextRetryAt.getTime() > now
    ? Math.max(1, Math.ceil((current.nextRetryAt.getTime() - now) / 1_000))
    : current.phaseLeaseExpiresAt && current.phaseLeaseExpiresAt.getTime() > now
      ? Math.max(
          1,
          Math.min(
            PHASE_CLAIM_RECHECK_MAX_SECONDS,
            Math.ceil((current.phaseLeaseExpiresAt.getTime() - now) / 1_000),
          ),
        )
      : 1;

  // A successor can be consumed by another worker process before the current
  // phase releases its lease. Always leave another durable delivery behind
  // instead of acknowledging the only successor and stranding the batch.
  await enqueueHubspotImportJob(input, { startAfterSeconds: retryDelaySeconds });
}

function phaseLeaseLostError(): ServiceError {
  return new ServiceError(
    "HUBSPOT_PHASE_LEASE_LOST",
    409,
    "The HubSpot direct-sync phase lease was lost to another worker",
  );
}

async function renewPhaseLease(
  importBatchId: string,
  lease: PhaseLease,
): Promise<void> {
  const renewed = await prisma.hubspotImportBatch.updateMany({
    where: { id: importBatchId, phaseLeaseOwner: lease.owner },
    data: {
      phaseLeaseExpiresAt: new Date(Date.now() + PHASE_LEASE_MS),
    },
  });
  if (renewed.count !== 1) {
    throw phaseLeaseLostError();
  }
}

async function releasePhaseLease(
  importBatchId: string,
  lease: PhaseLease,
): Promise<void> {
  const released = await prisma.hubspotImportBatch.updateMany({
    where: { id: importBatchId, phaseLeaseOwner: lease.owner },
    data: { phaseLeaseOwner: null, phaseLeaseExpiresAt: null },
  });
  if (released.count !== 1) {
    throw phaseLeaseLostError();
  }
}

async function withPhaseLeaseTransaction<T>(
  importBatchId: string,
  lease: PhaseLease,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return withDbTransaction(async (tx) => {
    const guarded = await tx.hubspotImportBatch.updateMany({
      where: { id: importBatchId, phaseLeaseOwner: lease.owner },
      data: {
        phaseLeaseExpiresAt: new Date(Date.now() + PHASE_LEASE_MS),
      },
    });
    if (guarded.count !== 1) {
      throw phaseLeaseLostError();
    }
    return callback(tx);
  });
}

async function prepareDirectBatch(
  importBatchId: string,
  lease: PhaseLease,
): Promise<void> {
  const rows = await prisma.hubspotImportBatchRow.findMany({
    where: { batchId: importBatchId },
    orderBy: [{ channelId: "asc" }, { contactEmail: "asc" }],
    select: { id: true, payload: true },
  });
  const csvRows: CsvPayload[] = [];
  for (const row of rows) {
    try {
      csvRows.push(parseCsvPayload(row.payload));
      await withPhaseLeaseTransaction(importBatchId, lease, (tx) => {
        return tx.hubspotImportBatchRow.update({
          where: { id: row.id },
          data: {
            status: PrismaHubspotImportBatchRowStatus.PREPARED,
            associationStatus: PrismaHubspotAssociationStatus.PENDING,
            retryable: false,
            errorMessage: null,
            providerErrorCode: null,
          },
        });
      });
    } catch (error) {
      if (error instanceof ServiceError && error.code === "HUBSPOT_PHASE_LEASE_LOST") {
        throw error;
      }
      await withPhaseLeaseTransaction(importBatchId, lease, (tx) => {
        return tx.hubspotImportBatchRow.update({
          where: { id: row.id },
          data: {
            status: PrismaHubspotImportBatchRowStatus.FAILED,
            associationStatus: PrismaHubspotAssociationStatus.FAILED,
            retryable: false,
            completedAt: new Date(),
            errorMessage: formatError(error),
          },
        });
      });
    }
  }
  const [preparedRowCount, failedRowCount] = await Promise.all([
    prisma.hubspotImportBatchRow.count({
      where: { batchId: importBatchId, status: PrismaHubspotImportBatchRowStatus.PREPARED },
    }),
    prisma.hubspotImportBatchRow.count({
      where: { batchId: importBatchId, status: PrismaHubspotImportBatchRowStatus.FAILED },
    }),
  ]);
  if (preparedRowCount === 0) {
    throw new ServiceError(
      "HUBSPOT_IMPORT_EMPTY_PREPARED",
      409,
      "HubSpot sync did not produce any valid rows",
    );
  }
  await withPhaseLeaseTransaction(importBatchId, lease, async (tx) => {
    const committed = await tx.hubspotImportBatch.updateMany({
      where: { id: importBatchId, phaseLeaseOwner: lease.owner },
      data: {
        status: PrismaHubspotImportBatchStatus.SUBMITTING,
        preparedRowCount,
        failedRowCount,
        csvContent: buildCsvContent(csvRows),
        nextRetryAt: null,
        lastError: null,
      },
    });
    if (committed.count !== 1) {
      throw phaseLeaseLostError();
    }
  });
}

export function isHubspotPartialFailureRetryable(
  outcome: HubspotBatchUpsertFailure,
): boolean {
  const classifier = `${outcome.category ?? ""} ${outcome.code ?? ""}`.toUpperCase();
  return ["RATE", "LIMIT", "LOCK", "TEMPOR", "TIMEOUT", "INTERNAL", "SERVER"]
    .some((part) => classifier.includes(part));
}

async function failRowsForDeal(input: {
  importBatchId: string;
  lease: PhaseLease;
  failure: HubspotBatchUpsertFailure;
}): Promise<void> {
  await withPhaseLeaseTransaction(input.importBatchId, input.lease, (tx) => {
    return tx.hubspotImportBatchRow.updateMany({
      where: {
        batchId: input.importBatchId,
        status: PrismaHubspotImportBatchRowStatus.PREPARED,
      },
      data: {
        status: PrismaHubspotImportBatchRowStatus.FAILED,
        associationStatus: PrismaHubspotAssociationStatus.FAILED,
        retryable: isHubspotPartialFailureRetryable(input.failure),
        providerErrorCode: input.failure.code,
        providerCorrelationId: input.failure.objectWriteTraceId,
        errorMessage: input.failure.message,
        completedAt: new Date(),
      },
    });
  });
}

async function submitDirectBatch(
  importBatchId: string,
  context: DirectContext,
  lease: PhaseLease,
): Promise<"next_phase" | "terminal"> {
  const batch = await prisma.hubspotImportBatch.findUniqueOrThrow({
    where: { id: importBatchId },
    select: { requestedByUserId: true },
  });
  const rows = await prisma.hubspotImportBatchRow.findMany({
    where: {
      batchId: importBatchId,
      OR: [
        { status: PrismaHubspotImportBatchRowStatus.PREPARED },
        {
          status: PrismaHubspotImportBatchRowStatus.SUBMITTING,
          hubspotContactId: null,
        },
      ],
    },
    orderBy: [{ channelId: "asc" }, { contactEmail: "asc" }],
    select: {
      id: true,
      channelId: true,
      channelContactId: true,
      contactEmail: true,
      externalKey: true,
      payload: true,
    },
  });
  const alreadySubmittedRowCount = await prisma.hubspotImportBatchRow.count({
    where: {
      batchId: importBatchId,
      status: PrismaHubspotImportBatchRowStatus.SUBMITTING,
      hubspotContactId: { not: null },
    },
  });
  if (rows.length === 0 && alreadySubmittedRowCount === 0) {
    throw new ServiceError(
      "HUBSPOT_SYNC_NO_RETRYABLE_ROWS",
      409,
      "The HubSpot sync has no prepared rows to submit",
    );
  }

  const parsedRows = rows.map((row) => ({ row, payload: parseCsvPayload(row.payload) }));
  const dealExternalKey = buildHubspotDealExternalKey(context.run.id);
  const dealProperties = context.dealProperties;
  await renewPhaseLease(importBatchId, lease);
  const dealResult = await batchUpsertHubspotDeals({
    accessToken: context.config.accessToken,
    baseUrl: context.config.baseUrl,
    records: [
      {
        id: dealExternalKey,
        idProperty: context.dealUniqueIdProperty,
        properties: dealProperties,
        objectWriteTraceId: `deal-${importBatchId}`,
      },
    ],
  });
  await renewPhaseLease(importBatchId, lease);
  const dealOutcome = dealResult.outcomes[0];
  if (!dealOutcome) {
    throw new ServiceError(
      "HUBSPOT_DEAL_RESPONSE_EMPTY",
      502,
      "HubSpot did not return a deal result",
    );
  }
  if (!dealOutcome.success) {
    await failRowsForDeal({ importBatchId, lease, failure: dealOutcome });
    const failedRowCount = await prisma.hubspotImportBatchRow.count({
      where: { batchId: importBatchId, status: PrismaHubspotImportBatchRowStatus.FAILED },
    });
    await withPhaseLeaseTransaction(importBatchId, lease, async (tx) => {
      const committed = await tx.hubspotImportBatch.updateMany({
        where: { id: importBatchId, phaseLeaseOwner: lease.owner },
        data: {
          status: PrismaHubspotImportBatchStatus.FAILED,
          externalStatus: PrismaHubspotExternalDeliveryStatus.FAILED,
          failedRowCount,
          completedAt: new Date(),
          nextRetryAt: null,
          lastError: dealOutcome.message,
          providerResultSummary: toJsonValue({ deal: "failed", code: dealOutcome.code }),
          phaseLeaseOwner: null,
          phaseLeaseExpiresAt: null,
        },
      });
      if (committed.count !== 1) {
        throw phaseLeaseLostError();
      }
    });
    return "terminal";
  }

  const submittedAt = new Date();
  await withPhaseLeaseTransaction(importBatchId, lease, (tx) => {
    return tx.hubspotDealLink.upsert({
      where: {
        hubspotPortalId_runRequestId: {
          hubspotPortalId: context.portalDatabaseId,
          runRequestId: context.run.id,
        },
      },
      create: {
        hubspotPortalId: context.portalDatabaseId,
        runRequestId: context.run.id,
        hubspotObjectId: dealOutcome.id,
        externalKey: dealExternalKey,
        lastOutboundHash: buildHubspotPreparationHash(dealProperties),
      },
      update: {
        hubspotObjectId: dealOutcome.id,
        externalKey: dealExternalKey,
        lastOutboundHash: buildHubspotPreparationHash(dealProperties),
      },
    });
  });

  const channelContactIds = rows.flatMap((row) =>
    row.channelContactId ? [row.channelContactId] : []
  );
  const existingLinks = channelContactIds.length === 0
    ? []
    : await prisma.hubspotContactLink.findMany({
        where: {
          hubspotPortalId: context.portalDatabaseId,
          channelContactId: { in: channelContactIds },
          archived: false,
        },
        select: { channelContactId: true, hubspotObjectId: true },
      });
  const existingLinkByContactId = new Map(
    existingLinks.map((link) => [link.channelContactId, link.hubspotObjectId]),
  );
  const legacyRows = rows.length === 0
    ? []
    : await prisma.hubspotPushBatchRow.findMany({
        where: {
          status: PrismaHubspotPushBatchRowStatus.PUSHED,
          hubspotObjectId: { not: null },
          channelId: { in: [...new Set(rows.map((row) => row.channelId))] },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: {
          channelId: true,
          contactEmail: true,
          hubspotObjectId: true,
        },
      });
  const legacyIdentityByChannelEmail = new Map<string, string>();
  for (const legacyRow of legacyRows) {
    if (!legacyRow.contactEmail || !legacyRow.hubspotObjectId) {
      continue;
    }
    const key = `${legacyRow.channelId}\0${legacyRow.contactEmail.trim().toLowerCase()}`;
    if (!legacyIdentityByChannelEmail.has(key)) {
      legacyIdentityByChannelEmail.set(key, legacyRow.hubspotObjectId);
    }
  }

  const contactInputs = parsedRows.map(({ row, payload }) => {
    if (!row.channelContactId || !row.externalKey) {
      throw new ServiceError(
        "HUBSPOT_CONTACT_IDENTITY_MISSING",
        500,
        "A prepared HubSpot row is missing its durable contact identity",
      );
    }
    const snapshot = payload.providerSnapshot;
    const influencerType = resolvePreparedReference({
      value: payload.csv["Influencer Type"],
      fieldLabel: "Influencer Type",
      references: context.dropdownReferences.influencerType,
    });
    const influencerVertical = resolvePreparedReference({
      value: payload.csv["Influencer Vertical"],
      fieldLabel: "Influencer Vertical",
      references: context.dropdownReferences.influencerVertical,
    });
    const countryRegion = resolvePreparedReference({
      value: payload.csv["Country/Region"],
      fieldLabel: "Country/Region",
      references: context.dropdownReferences.countryRegion,
    });
    const language = resolvePreparedReference({
      value: payload.csv.Language,
      fieldLabel: "Language",
      references: context.dropdownReferences.language,
    });
    const properties = buildHubspotOutboundProperties({
      values: {
        [context.contactUniqueIdProperty]: row.externalKey,
        firstname: payload.csv["First Name"],
        lastname: payload.csv["Last Name"],
        email: payload.csv.Email,
        phone: payload.csv["Phone Number"],
        contact_type: payload.csv["Contact Type"],
        platforms: "YouTube",
        influencer_type: influencerType,
        influencer_vertical: influencerVertical,
        country: countryRegion,
        language,
        youtube_url: snapshot.youtubeUrl,
        youtube_handle: snapshot.youtubeHandle,
        influencer_url: snapshot.youtubeUrl,
        youtube_followers: snapshot.youtubeFollowers ?? snapshot.subscriberCount,
        youtube_video_median_views: snapshot.youtubeVideoMedianViews,
        youtube_shorts_median_views: snapshot.youtubeShortsMedianViews,
        youtube_engagement_rate: snapshot.youtubeEngagementRate,
        influencer_size: computeInfluencerSizeTier(
          snapshot.subscriberCount ? BigInt(snapshot.subscriberCount) : null,
        ),
      },
    });
    const linkedObjectId = existingLinkByContactId.get(row.channelContactId);
    const legacyObjectId = legacyIdentityByChannelEmail.get(
      `${row.channelId}\0${row.contactEmail.trim().toLowerCase()}`,
    );
    return {
      row,
      properties,
      writeMode: legacyObjectId && !linkedObjectId ? "record_id_update" as const : "upsert" as const,
      identityId: linkedObjectId ? row.externalKey : legacyObjectId ?? row.contactEmail,
      identityProperty: linkedObjectId
        ? context.contactUniqueIdProperty
        : legacyObjectId
          ? null
          : "email",
    };
  });
  if (rows.length > 0) {
    await withPhaseLeaseTransaction(importBatchId, lease, (tx) => {
      return tx.hubspotImportBatchRow.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: {
          status: PrismaHubspotImportBatchRowStatus.SUBMITTING,
          attemptCount: { increment: 1 },
          lastAttemptAt: submittedAt,
          errorMessage: null,
          providerErrorCode: null,
          providerCorrelationId: null,
        },
      });
    });
  }
  const persistedContactTraces = new Set<string>();
  const persistContactOutcomes = async (
    outcomes: readonly HubspotBatchUpsertOutcome[],
    submittedItems: readonly (typeof contactInputs)[number][],
  ): Promise<void> => {
    for (const outcome of outcomes) {
      if (persistedContactTraces.has(outcome.objectWriteTraceId)) {
        continue;
      }
      const item = submittedItems[outcome.inputIndex];
      if (!item) {
        throw new ServiceError(
          "HUBSPOT_CONTACT_RESPONSE_UNMAPPED",
          502,
          "A HubSpot contact result could not be mapped to its row",
        );
      }
      if (!outcome.success) {
        await withPhaseLeaseTransaction(importBatchId, lease, (tx) => {
          return tx.hubspotImportBatchRow.update({
            where: { id: item.row.id },
            data: {
              status: PrismaHubspotImportBatchRowStatus.FAILED,
              associationStatus: PrismaHubspotAssociationStatus.FAILED,
              retryable: isHubspotPartialFailureRetryable(outcome),
              providerErrorCode: outcome.code,
              providerCorrelationId: outcome.objectWriteTraceId,
              errorMessage: outcome.message,
              completedAt: new Date(),
            },
          });
        });
        persistedContactTraces.add(outcome.objectWriteTraceId);
        continue;
      }
      await withPhaseLeaseTransaction(importBatchId, lease, async (tx) => {
        await tx.hubspotContactLink.upsert({
          where: {
            hubspotPortalId_channelContactId: {
              hubspotPortalId: context.portalDatabaseId,
              channelContactId: item.row.channelContactId!,
            },
          },
          create: {
            hubspotPortalId: context.portalDatabaseId,
            channelContactId: item.row.channelContactId!,
            hubspotObjectId: outcome.id,
            externalKey: item.row.externalKey!,
            lastOutboundHash: buildHubspotPreparationHash(item.properties),
          },
          update: {
            hubspotObjectId: outcome.id,
            externalKey: item.row.externalKey!,
            lastOutboundHash: buildHubspotPreparationHash(item.properties),
            archived: false,
          },
        });
        await tx.hubspotImportBatchRow.update({
          where: { id: item.row.id },
          data: {
            status: PrismaHubspotImportBatchRowStatus.SUBMITTING,
            hubspotContactId: outcome.id,
            hubspotDealId: dealOutcome.id,
            submittedAt,
            retryable: false,
            providerCorrelationId: outcome.objectWriteTraceId,
            errorMessage: null,
          },
        });
      });
      persistedContactTraces.add(outcome.objectWriteTraceId);
    }
  };
  const legacyUpdateInputs = contactInputs.filter(
    (item) => item.writeMode === "record_id_update",
  );
  const upsertContactInputs = contactInputs.filter(
    (item) => item.writeMode === "upsert",
  );
  const legacyUpdateResult = legacyUpdateInputs.length === 0
    ? { outcomes: [], succeeded: 0, failed: 0 }
    : await batchUpdateHubspotContacts({
        accessToken: context.config.accessToken,
        baseUrl: context.config.baseUrl,
        records: legacyUpdateInputs.map(({ row, properties, identityId }) => ({
          id: identityId,
          properties,
          objectWriteTraceId: row.id,
        })),
        onChunkComplete: async (checkpoint) => {
          await renewPhaseLease(importBatchId, lease);
          await persistContactOutcomes(checkpoint.outcomes, legacyUpdateInputs);
        },
      });
  await persistContactOutcomes(legacyUpdateResult.outcomes, legacyUpdateInputs);
  await renewPhaseLease(importBatchId, lease);

  const contactsResult = upsertContactInputs.length === 0
    ? { outcomes: [], succeeded: 0, failed: 0 }
    : await batchUpsertHubspotContacts({
        accessToken: context.config.accessToken,
        baseUrl: context.config.baseUrl,
        records: upsertContactInputs.map(({ row, properties, identityId, identityProperty }) => ({
          id: identityId,
          idProperty: identityProperty!,
          properties,
          objectWriteTraceId: row.id,
        })),
        allowEmailIdentifierForFullUpsert: true,
        onChunkComplete: async (checkpoint) => {
          await renewPhaseLease(importBatchId, lease);
          await persistContactOutcomes(checkpoint.outcomes, upsertContactInputs);
        },
      });
  await persistContactOutcomes(contactsResult.outcomes, upsertContactInputs);
  await renewPhaseLease(importBatchId, lease);

  const contactsSucceeded = legacyUpdateResult.succeeded + contactsResult.succeeded;
  const contactsFailed = legacyUpdateResult.failed + contactsResult.failed;

  const failedRowCount = await prisma.hubspotImportBatchRow.count({
    where: { batchId: importBatchId, status: PrismaHubspotImportBatchRowStatus.FAILED },
  });
  await withPhaseLeaseTransaction(importBatchId, lease, async (tx) => {
    const committed = await tx.hubspotImportBatch.updateMany({
      where: { id: importBatchId, phaseLeaseOwner: lease.owner },
      data: {
        status: PrismaHubspotImportBatchStatus.PROCESSING,
        externalStatus: PrismaHubspotExternalDeliveryStatus.PROCESSING,
        submittedAt,
        lastPolledAt: submittedAt,
        failedRowCount,
        nextRetryAt: null,
        providerResultSummary: toJsonValue({
          transport: "object_api",
          dealId: dealOutcome.id,
          contactsSucceeded,
          contactsFailed,
          activationType: context.dealProperties.activation_type ?? null,
        }),
      },
    });
    if (committed.count !== 1) {
      throw phaseLeaseLostError();
    }
    await tx.auditEvent.create({
      data: {
        actorUserId: batch.requestedByUserId,
        action: "hubspot_sync.submitted",
        entityType: "hubspot_import_batch",
        entityId: importBatchId,
        metadata: {
          contactsSucceeded,
          contactsFailed,
        },
      },
    });
  });
  return "next_phase";
}

async function createRequiredAssociation(input: {
  context: DirectContext;
  fromObjectType: string;
  toObjectType: string;
  fromId: string;
  toId: string;
  definition: AssociationReference;
}): Promise<string[]> {
  const result = await createHubspotAssociations({
    accessToken: input.context.config.accessToken,
    baseUrl: input.context.config.baseUrl,
    fromObjectType: input.fromObjectType,
    toObjectType: input.toObjectType,
    preserveExistingLabels: true,
    associations: [
      {
        fromId: input.fromId,
        toId: input.toId,
        associationTypeId: input.definition.associationTypeId,
        associationCategory: input.definition.associationCategory,
      },
    ],
  });
  const errors = result.errors.map((error) => error.message);
  if (result.accepted !== result.submitted && errors.length === 0) {
    errors.push(
      `HubSpot accepted ${result.accepted} of ${result.submitted} required associations`,
    );
  }
  return errors;
}

function associationErrors(result: {
  submitted: number;
  accepted: number;
  errors: readonly { message: string }[];
}): string[] {
  const errors = result.errors.map((error) => error.message);
  if (result.accepted !== result.submitted && errors.length === 0) {
    errors.push(`HubSpot accepted ${result.accepted} of ${result.submitted} associations`);
  }
  return errors;
}

function isAssociationFailureRetryable(
  error: HubspotAssociationBatchError | null,
): boolean {
  if (!error) {
    return true;
  }
  const signal = `${error.category ?? ""} ${error.code ?? ""}`.toUpperCase();
  return [
    "RATE_LIMIT",
    "TOO_MANY_REQUESTS",
    "TIMEOUT",
    "TEMPORARY",
    "LOCKED",
    "INTERNAL",
    "SERVER_ERROR",
    "ASSOCIATION_NOT_CONFIRMED",
  ].some((candidate) => signal.includes(candidate));
}

async function associateDirectBatch(
  importBatchId: string,
  context: DirectContext,
  lease: PhaseLease,
): Promise<void> {
  const batch = await prisma.hubspotImportBatch.findUniqueOrThrow({
    where: { id: importBatchId },
    select: {
      requestedByUserId: true,
      providerResultSummary: true,
    },
  });
  const dealLink = await prisma.hubspotDealLink.findUnique({
    where: {
      hubspotPortalId_runRequestId: {
        hubspotPortalId: context.portalDatabaseId,
        runRequestId: context.run.id,
      },
    },
    select: { hubspotObjectId: true },
  });
  const dealId = dealLink?.hubspotObjectId ?? null;
  if (!dealId) {
    throw new ServiceError(
      "HUBSPOT_DEAL_LINK_MISSING",
      500,
      "The direct sync is missing its HubSpot deal identity",
    );
  }
  const rows = await prisma.hubspotImportBatchRow.findMany({
    where: {
      batchId: importBatchId,
      status: PrismaHubspotImportBatchRowStatus.SUBMITTING,
      hubspotContactId: { not: null },
    },
    orderBy: [{ channelId: "asc" }, { contactEmail: "asc" }],
    select: { id: true, hubspotContactId: true },
  });

  await renewPhaseLease(importBatchId, lease);
  const dealToCampaignErrors = await createRequiredAssociation({
      context,
      fromObjectType: "deals",
      toObjectType: context.run.campaign.hubspotObjectType,
      fromId: dealId,
      toId: context.run.campaign.hubspotObjectId,
      definition: context.dealToCampaign,
    });
  await renewPhaseLease(importBatchId, lease);
  const dealToClientErrors = context.dealToClient
    ? await createRequiredAssociation({
        context,
        fromObjectType: "deals",
        toObjectType: context.run.campaign.client.hubspotObjectType,
        fromId: dealId,
        toId: context.run.campaign.client.hubspotObjectId,
        definition: context.dealToClient,
      })
    : [];
  await renewPhaseLease(importBatchId, lease);
  const campaignToClientErrors = await createRequiredAssociation({
      context,
      fromObjectType: context.run.campaign.hubspotObjectType,
      toObjectType: context.run.campaign.client.hubspotObjectType,
      fromId: context.run.campaign.hubspotObjectId,
      toId: context.run.campaign.client.hubspotObjectId,
      definition: context.campaignToClient,
    });
  await renewPhaseLease(importBatchId, lease);
  const graphErrors = [
    ...dealToCampaignErrors,
    ...dealToClientErrors,
    ...campaignToClientErrors,
  ];

  await renewPhaseLease(importBatchId, lease);
  const contactAssociationResult = rows.length === 0
    ? null
    : await createHubspotAssociations({
        accessToken: context.config.accessToken,
        baseUrl: context.config.baseUrl,
        fromObjectType: "contacts",
        toObjectType: "deals",
        preserveExistingLabels: true,
        associations: rows.map((row) => ({
          fromId: row.hubspotContactId!,
          toId: dealId,
          associationTypeId: context.contactToDeal.associationTypeId,
          associationCategory: context.contactToDeal.associationCategory,
        })),
      });
  await renewPhaseLease(importBatchId, lease);
  const contactAssociationErrors = rows.length === 0
    ? []
    : associationErrors(contactAssociationResult!);
  const failedContactAssociationRows = contactAssociationResult?.outcomes
    .flatMap((outcome) => {
      const row = rows[outcome.inputIndex];
      return !outcome.success && row
        ? [{
            row,
            error: outcome.error,
            message: outcome.error?.message
              ?? "HubSpot did not confirm the contact association",
          }]
        : [];
    }) ?? [];
  const requiredErrors = [
    ...graphErrors,
    ...contactAssociationErrors,
  ];
  const completedAt = new Date();
  const graphFailed = graphErrors.length > 0;
  const unmappedContactFailure =
    contactAssociationErrors.length > 0 && failedContactAssociationRows.length === 0;
  const failedRowIds = new Set(
    graphFailed || unmappedContactFailure
      ? rows.map((row) => row.id)
      : failedContactAssociationRows.map((item) => item.row.id),
  );
  const successfulRows = rows.filter((row) => !failedRowIds.has(row.id));
  const failedRows = rows.filter((row) => failedRowIds.has(row.id));
  if (failedRows.length > 0) {
    const contactFailureByRowId = new Map(
      failedContactAssociationRows.map((failure) => [failure.row.id, failure]),
    );
    await withPhaseLeaseTransaction(importBatchId, lease, async (tx) => {
      await Promise.all(failedRows.map((row) => {
        const failure = contactFailureByRowId.get(row.id);
        return tx.hubspotImportBatchRow.update({
          where: { id: row.id },
          data: {
            status: PrismaHubspotImportBatchRowStatus.FAILED,
            associationStatus: PrismaHubspotAssociationStatus.FAILED,
            retryable: graphFailed || unmappedContactFailure
              ? true
              : isAssociationFailureRetryable(failure?.error ?? null),
            providerErrorCode:
              failure?.error?.code ?? "ASSOCIATION_PARTIAL_FAILURE",
            errorMessage: (graphErrors[0]
              ?? failure?.message
              ?? "HubSpot did not confirm the required association").slice(0, 1_000),
            completedAt,
          },
        });
      }));
    });
  }
  if (successfulRows.length > 0) {
    await withPhaseLeaseTransaction(importBatchId, lease, async (tx) => {
      await tx.hubspotImportBatchRow.updateMany({
        where: { id: { in: successfulRows.map((row) => row.id) } },
        data: {
          status: PrismaHubspotImportBatchRowStatus.SYNCED,
          associationStatus: PrismaHubspotAssociationStatus.ASSOCIATED,
          retryable: false,
          errorMessage: null,
          completedAt,
        },
      });
      await tx.hubspotContactLink.updateMany({
        where: {
          hubspotPortalId: context.portalDatabaseId,
          hubspotObjectId: { in: successfulRows.map((row) => row.hubspotContactId!) },
        },
        data: { lastSuccessfulSyncAt: completedAt },
      });
    });
  }
  if (!graphFailed) {
    await withPhaseLeaseTransaction(importBatchId, lease, (tx) => {
      return tx.hubspotDealLink.updateMany({
        where: {
          hubspotPortalId: context.portalDatabaseId,
          runRequestId: context.run.id,
        },
        data: { lastSuccessfulSyncAt: completedAt },
      });
    });
  }

  const [syncedRowCount, failedRowCount] = await Promise.all([
    prisma.hubspotImportBatchRow.count({
      where: { batchId: importBatchId, status: PrismaHubspotImportBatchRowStatus.SYNCED },
    }),
    prisma.hubspotImportBatchRow.count({
      where: { batchId: importBatchId, status: PrismaHubspotImportBatchRowStatus.FAILED },
    }),
  ]);
  const hasErrors = failedRowCount > 0 || requiredErrors.length > 0;
  const previousSummary = isJsonObject(batch.providerResultSummary)
    ? batch.providerResultSummary
    : {};
  await withPhaseLeaseTransaction(importBatchId, lease, async (tx) => {
    const committed = await tx.hubspotImportBatch.updateMany({
      where: { id: importBatchId, phaseLeaseOwner: lease.owner },
      data: {
        status: hasErrors
          ? PrismaHubspotImportBatchStatus.COMPLETED_WITH_ERRORS
          : PrismaHubspotImportBatchStatus.COMPLETED,
        externalStatus: hasErrors
          ? PrismaHubspotExternalDeliveryStatus.COMPLETED_WITH_ERRORS
          : PrismaHubspotExternalDeliveryStatus.COMPLETED,
        syncedRowCount,
        failedRowCount,
        completedAt,
        lastPolledAt: completedAt,
        nextRetryAt: null,
        phaseLeaseOwner: null,
        phaseLeaseExpiresAt: null,
        lastError: hasErrors ? requiredErrors[0] ?? "One or more rows failed" : null,
        providerResultSummary: toJsonValue({
          ...previousSummary,
          associationsCompleted: requiredErrors.length === 0,
          dealCampaignAssociation: {
            status: dealToCampaignErrors.length === 0 ? "confirmed" : "failed",
            dealId,
            campaignId: context.run.campaign.hubspotObjectId,
            associationTypeId: context.dealToCampaign.associationTypeId,
          },
          dealClientAssociation: context.dealToClient
            ? {
                status: dealToClientErrors.length === 0 ? "confirmed" : "failed",
                dealId,
                clientId: context.run.campaign.client.hubspotObjectId,
                associationTypeId: context.dealToClient.associationTypeId,
              }
            : {
                status: "not_required_legacy_snapshot",
                dealId,
                clientId: context.run.campaign.client.hubspotObjectId,
              },
          campaignClientAssociation: {
            status: campaignToClientErrors.length === 0 ? "confirmed" : "failed",
            campaignId: context.run.campaign.hubspotObjectId,
            clientId: context.run.campaign.client.hubspotObjectId,
            associationTypeId: context.campaignToClient.associationTypeId,
          },
        }),
      },
    });
    if (committed.count !== 1) {
      throw phaseLeaseLostError();
    }
    await tx.auditEvent.create({
      data: {
        actorUserId: batch.requestedByUserId,
        action: hasErrors ? "hubspot_sync.completed_with_errors" : "hubspot_sync.completed",
        entityType: "hubspot_import_batch",
        entityId: importBatchId,
        metadata: { syncedRowCount, failedRowCount },
      },
    });
  });
}

async function handlePhaseFailure(input: {
  importBatchId: string;
  requestedByUserId: string;
  lease: PhaseLease | null;
  error: unknown;
}): Promise<void> {
  if (
    !input.lease
    || (input.error instanceof ServiceError && input.error.code === "HUBSPOT_PHASE_LEASE_LOST")
  ) {
    return;
  }
  const batch = await prisma.hubspotImportBatch.findFirst({
    where: { id: input.importBatchId, phaseLeaseOwner: input.lease.owner },
    select: { retryCount: true, status: true },
  });
  if (!batch) {
    return;
  }
  const retryCount = batch.retryCount + 1;
  // Provider errors tell us explicitly whether retrying is safe. Unexpected
  // infrastructure errors (for example, the next-phase enqueue failing after
  // state was persisted) are also retried so a transient queue outage cannot
  // turn a resumable batch into a terminal failure. Domain validation errors
  // are ServiceErrors and remain terminal.
  const retryable = isHubspotError(input.error)
    ? input.error.retryable
    : !(input.error instanceof ServiceError);
  const terminal = !retryable || retryCount > MAX_PHASE_RETRIES;
  const retryAfterMs = isHubspotError(input.error)
    ? input.error.retryAfterMs ?? Math.min(30 * 60_000, 30_000 * 2 ** (retryCount - 1))
    : Math.min(30 * 60_000, 30_000 * 2 ** (retryCount - 1));
  const nextRetryAt = terminal ? null : new Date(Date.now() + retryAfterMs);
  const lastError = formatError(input.error);
  const failureData: Prisma.HubspotImportBatchUpdateManyMutationInput = {
    status: terminal ? PrismaHubspotImportBatchStatus.FAILED : batch.status,
    ...(terminal
      ? { externalStatus: PrismaHubspotExternalDeliveryStatus.FAILED }
      : {}),
    retryCount,
    nextRetryAt,
    completedAt: terminal ? new Date() : null,
    lastError,
    phaseLeaseExpiresAt: new Date(Date.now() + PHASE_LEASE_MS),
    ...(isHubspotError(input.error)
      ? { providerCorrelationId: input.error.correlationId }
      : {}),
  };
  if (terminal) {
    await withDbTransaction(async (tx) => {
      const failed = await tx.hubspotImportBatch.updateMany({
        where: { id: input.importBatchId, phaseLeaseOwner: input.lease!.owner },
        data: {
          ...failureData,
          phaseLeaseOwner: null,
          phaseLeaseExpiresAt: null,
        },
      });
      if (failed.count !== 1) {
        return;
      }
      await tx.auditEvent.create({
        data: {
          actorUserId: input.requestedByUserId,
          action: "hubspot_sync.failed",
          entityType: "hubspot_import_batch",
          entityId: input.importBatchId,
          metadata: { retryCount, lastError },
        },
      });
    });
    return;
  }
  const persisted = await prisma.hubspotImportBatch.updateMany({
    where: { id: input.importBatchId, phaseLeaseOwner: input.lease.owner },
    data: failureData,
  });
  if (persisted.count !== 1) {
    return;
  }
  if (!terminal && nextRetryAt) {
    try {
      await enqueueHubspotImportJob(
        {
          importBatchId: input.importBatchId,
          requestedByUserId: input.requestedByUserId,
        },
        { startAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)) },
      );
      await releasePhaseLease(input.importBatchId, input.lease);
    } catch (enqueueError) {
      // The current pg-boss job can retry immediately. Clear the persisted
      // delay so that retry can reclaim the phase instead of returning early
      // and leaving a batch with no future job.
      await prisma.hubspotImportBatch.updateMany({
        where: { id: input.importBatchId, phaseLeaseOwner: input.lease.owner },
        data: {
          nextRetryAt: null,
          phaseLeaseOwner: null,
          phaseLeaseExpiresAt: null,
          lastError: `${lastError}; retry enqueue failed: ${formatError(enqueueError)}`
            .slice(0, 2_000),
        },
      });
      throw enqueueError;
    }
  }
}

export async function executeDirectHubspotImportBatch(input: {
  importBatchId: string;
  requestedByUserId: string;
}): Promise<void> {
  const batch = await prisma.hubspotImportBatch.findUnique({
    where: { id: input.importBatchId },
    select: {
      requestedByUserId: true,
      runRequestId: true,
      hubspotPortalId: true,
      directSyncSnapshot: true,
      status: true,
    },
  });
  if (!batch) {
    return;
  }
  if (batch.requestedByUserId !== input.requestedByUserId) {
    throw new ServiceError("HUBSPOT_IMPORT_USER_MISMATCH", 403, "HubSpot sync user mismatch");
  }
  if (
    batch.status === PrismaHubspotImportBatchStatus.COMPLETED
    || batch.status === PrismaHubspotImportBatchStatus.COMPLETED_WITH_ERRORS
    || batch.status === PrismaHubspotImportBatchStatus.FAILED
  ) {
    return;
  }

  let lease: PhaseLease | null = null;
  try {
    if (
      batch.status === PrismaHubspotImportBatchStatus.QUEUED
      || batch.status === PrismaHubspotImportBatchStatus.PREPARING
    ) {
      lease = await claimPhase(
        input.importBatchId,
        [PrismaHubspotImportBatchStatus.QUEUED, PrismaHubspotImportBatchStatus.PREPARING],
        PrismaHubspotImportBatchStatus.PREPARING,
      );
      if (!lease) {
        await deferContendedPhase(input);
        return;
      }
      await prepareDirectBatch(input.importBatchId, lease);
      await enqueueHubspotImportJob(input, { startAfterSeconds: 1 });
      await releasePhaseLease(input.importBatchId, lease);
      return;
    }

    if (
      batch.status === PrismaHubspotImportBatchStatus.SUBMITTING
      || batch.status === PrismaHubspotImportBatchStatus.SUBMITTED
    ) {
      lease = await claimPhase(
        input.importBatchId,
        [PrismaHubspotImportBatchStatus.SUBMITTING, PrismaHubspotImportBatchStatus.SUBMITTED],
        PrismaHubspotImportBatchStatus.SUBMITTING,
      );
      if (!lease) {
        await deferContendedPhase(input);
        return;
      }
      const context = loadPersistedDirectContext({
        snapshotValue: batch.directSyncSnapshot,
        hubspotPortalId: batch.hubspotPortalId,
        runRequestId: batch.runRequestId,
      });
      const result = await submitDirectBatch(input.importBatchId, context, lease);
      if (result === "next_phase") {
        await enqueueHubspotImportJob(input, { startAfterSeconds: 1 });
        await releasePhaseLease(input.importBatchId, lease);
      }
      return;
    }
    if (batch.status === PrismaHubspotImportBatchStatus.PROCESSING) {
      lease = await claimPhase(
        input.importBatchId,
        [PrismaHubspotImportBatchStatus.PROCESSING],
        PrismaHubspotImportBatchStatus.PROCESSING,
      );
      if (!lease) {
        await deferContendedPhase(input);
        return;
      }
      const context = loadPersistedDirectContext({
        snapshotValue: batch.directSyncSnapshot,
        hubspotPortalId: batch.hubspotPortalId,
        runRequestId: batch.runRequestId,
      });
      await associateDirectBatch(input.importBatchId, context, lease);
    }
  } catch (error) {
    await handlePhaseFailure({ ...input, lease, error });
    throw error;
  }
}

export type HubspotDirectSyncPhase = "prepare" | "submit" | "associate" | "terminal";

export function getHubspotDirectSyncPhase(
  status: PrismaHubspotImportBatchStatus,
): HubspotDirectSyncPhase {
  if (
    status === PrismaHubspotImportBatchStatus.QUEUED
    || status === PrismaHubspotImportBatchStatus.PREPARING
  ) {
    return "prepare";
  }
  if (
    status === PrismaHubspotImportBatchStatus.SUBMITTING
    || status === PrismaHubspotImportBatchStatus.SUBMITTED
  ) {
    return "submit";
  }
  if (status === PrismaHubspotImportBatchStatus.PROCESSING) {
    return "associate";
  }
  return "terminal";
}

export async function retryDirectHubspotImportBatch(input: {
  importBatchId: string;
  batchOwnerUserId: string;
  actorUserId: string;
}): Promise<number> {
  const retriedRowCount = await withDbTransaction(async (tx) => {
    const batch = await tx.hubspotImportBatch.findUnique({
      where: { id: input.importBatchId },
      select: { requestedByUserId: true, status: true },
    });
    if (!batch || batch.requestedByUserId !== input.batchOwnerUserId) {
      throw new ServiceError("HUBSPOT_IMPORT_BATCH_NOT_FOUND", 404, "HubSpot batch not found");
    }
    if (
      batch.status !== PrismaHubspotImportBatchStatus.FAILED
      && batch.status !== PrismaHubspotImportBatchStatus.COMPLETED_WITH_ERRORS
    ) {
      throw new ServiceError(
        "HUBSPOT_IMPORT_RETRY_NOT_READY",
        409,
        "Only failed or partially completed HubSpot batches can be retried",
      );
    }
    const retryableFailedRows = await tx.hubspotImportBatchRow.findMany({
      where: {
        batchId: input.importBatchId,
        status: PrismaHubspotImportBatchRowStatus.FAILED,
        retryable: true,
      },
      select: {
        id: true,
        associationStatus: true,
        hubspotContactId: true,
        hubspotDealId: true,
      },
    });
    const associationOnlyRowIds = retryableFailedRows
      .filter(
        (row) =>
          row.associationStatus === PrismaHubspotAssociationStatus.FAILED
          && Boolean(row.hubspotContactId)
          && Boolean(row.hubspotDealId),
      )
      .map((row) => row.id);
    const associationOnlyRowIdSet = new Set(associationOnlyRowIds);
    const submitAgainRowIds = retryableFailedRows
      .filter((row) => !associationOnlyRowIdSet.has(row.id))
      .map((row) => row.id);
    const resetData = {
      associationStatus: PrismaHubspotAssociationStatus.PENDING,
      retryable: false,
      errorMessage: null,
      providerErrorCode: null,
      providerCorrelationId: null,
      completedAt: null,
    } as const;
    if (associationOnlyRowIds.length > 0) {
      await tx.hubspotImportBatchRow.updateMany({
        where: { id: { in: associationOnlyRowIds } },
        data: {
          ...resetData,
          status: PrismaHubspotImportBatchRowStatus.SUBMITTING,
        },
      });
    }
    if (submitAgainRowIds.length > 0) {
      await tx.hubspotImportBatchRow.updateMany({
        where: { id: { in: submitAgainRowIds } },
        data: {
          ...resetData,
          status: PrismaHubspotImportBatchRowStatus.PREPARED,
        },
      });
    }
    let nextStatus: PrismaHubspotImportBatchStatus =
      retryableFailedRows.length > 0
      && associationOnlyRowIds.length === retryableFailedRows.length
        ? PrismaHubspotImportBatchStatus.PROCESSING
        : PrismaHubspotImportBatchStatus.SUBMITTING;
    let retriedCount = retryableFailedRows.length;

    // A thrown provider/transport error is batch-scoped, so rows may still be
    // PREPARED or SUBMITTING when the automatic retry budget is exhausted.
    // Recover the durable phase without pretending those rows were per-record
    // failures, and never reset rows that are already SYNCED.
    if (retriedCount === 0) {
      const resumableRows = await tx.hubspotImportBatchRow.findMany({
        where: {
          batchId: input.importBatchId,
          status: {
            in: [
              PrismaHubspotImportBatchRowStatus.PENDING,
              PrismaHubspotImportBatchRowStatus.PREPARED,
              PrismaHubspotImportBatchRowStatus.SUBMITTING,
            ],
          },
        },
        select: {
          id: true,
          status: true,
          hubspotContactId: true,
          hubspotDealId: true,
        },
      });
      if (resumableRows.length === 0) {
        throw new ServiceError(
          "HUBSPOT_IMPORT_NO_RETRYABLE_ROWS",
          409,
          "This HubSpot batch has no retryable failed rows or resumable phase",
        );
      }

      retriedCount = resumableRows.length;
      if (resumableRows.some((row) => row.status === PrismaHubspotImportBatchRowStatus.PENDING)) {
        nextStatus = PrismaHubspotImportBatchStatus.QUEUED;
      } else {
        const incompleteSubmittedRows = resumableRows.filter(
          (row) =>
            row.status === PrismaHubspotImportBatchRowStatus.SUBMITTING
            && (!row.hubspotContactId || !row.hubspotDealId),
        );
        if (incompleteSubmittedRows.length > 0) {
          await tx.hubspotImportBatchRow.updateMany({
            where: { id: { in: incompleteSubmittedRows.map((row) => row.id) } },
            data: {
              status: PrismaHubspotImportBatchRowStatus.PREPARED,
              associationStatus: PrismaHubspotAssociationStatus.PENDING,
              completedAt: null,
            },
          });
        } else if (
          resumableRows.every(
            (row) => row.status === PrismaHubspotImportBatchRowStatus.SUBMITTING,
          )
        ) {
          nextStatus = PrismaHubspotImportBatchStatus.PROCESSING;
        }
      }
    }
    const failedRowCount = await tx.hubspotImportBatchRow.count({
      where: {
        batchId: input.importBatchId,
        status: PrismaHubspotImportBatchRowStatus.FAILED,
      },
    });
    await tx.hubspotImportBatch.update({
      where: { id: input.importBatchId },
      data: {
        status: nextStatus,
        externalStatus: PrismaHubspotExternalDeliveryStatus.PROCESSING,
        failedRowCount,
        retryCount: 0,
        completedAt: null,
        nextRetryAt: null,
        phaseLeaseOwner: null,
        phaseLeaseExpiresAt: null,
        lastError: null,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "hubspot_sync.failed_rows_retried",
        entityType: "hubspot_import_batch",
        entityId: input.importBatchId,
        metadata: { retriedRowCount: retriedCount, resumedStatus: nextStatus },
      },
    });
    return retriedCount;
  });
  try {
    await enqueueHubspotImportJob({
      importBatchId: input.importBatchId,
      requestedByUserId: input.batchOwnerUserId,
    });
  } catch (error) {
    await markDirectHubspotEnqueueFailure({ ...input, error });
    throw error;
  }
  return retriedRowCount;
}

export async function markDirectHubspotEnqueueFailure(input: {
  importBatchId: string;
  batchOwnerUserId: string;
  actorUserId: string;
  error: unknown;
}): Promise<void> {
  const lastError = `HubSpot sync queue unavailable: ${formatError(input.error)}`.slice(0, 2_000);
  const completedAt = new Date();
  await withDbTransaction(async (tx) => {
    const updated = await tx.hubspotImportBatch.updateMany({
      where: {
        id: input.importBatchId,
        requestedByUserId: input.batchOwnerUserId,
        status: {
          in: [
            PrismaHubspotImportBatchStatus.QUEUED,
            PrismaHubspotImportBatchStatus.PREPARING,
            PrismaHubspotImportBatchStatus.SUBMITTING,
            PrismaHubspotImportBatchStatus.SUBMITTED,
            PrismaHubspotImportBatchStatus.PROCESSING,
          ],
        },
        OR: [
          { phaseLeaseOwner: null },
          { phaseLeaseExpiresAt: { lte: completedAt } },
        ],
      },
      data: {
        status: PrismaHubspotImportBatchStatus.FAILED,
        externalStatus: PrismaHubspotExternalDeliveryStatus.FAILED,
        completedAt,
        nextRetryAt: null,
        phaseLeaseOwner: null,
        phaseLeaseExpiresAt: null,
        lastError,
      },
    });
    if (updated.count === 0) {
      return;
    }
    await tx.auditEvent.create({
      data: {
        actorUserId: input.actorUserId,
        action: "hubspot_sync.enqueue_failed",
        entityType: "hubspot_import_batch",
        entityId: input.importBatchId,
        metadata: { lastError },
      },
    });
  });
}

export { HubspotError };
