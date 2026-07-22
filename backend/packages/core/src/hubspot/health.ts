import { randomUUID } from "node:crypto";

import {
  HubspotDeliveryMode as PrismaHubspotDeliveryMode,
  HubspotHealthCheckRunStatus as PrismaHubspotHealthCheckRunStatus,
  HubspotImportBatchStatus as PrismaHubspotImportBatchStatus,
  HubspotPortalHealthStatus as PrismaHubspotPortalHealthStatus,
  Prisma,
  Role,
  UserType,
} from "@prisma/client";
import {
  hubspotHealthCheckRunSchema,
  hubspotHealthReportSchema,
  hubspotHealthStateSchema,
  hubspotReadinessSchema,
  type HubspotHealthCheck,
  type HubspotHealthCheckRun,
  type HubspotHealthReport,
  type HubspotHealthState,
  type HubspotReadiness,
} from "@scouting-platform/contracts";
import { prisma, withDbTransaction } from "@scouting-platform/db";
import {
  fetchHubspotAccountIdentity,
  fetchHubspotAssociationLabels,
  fetchHubspotObjectSchemas,
  fetchHubspotOwners,
  fetchHubspotPipelines,
  fetchHubspotProperties,
  fetchHubspotPropertyDefinition,
  isHubspotError,
  loadHubspotConfig,
  loadHubspotFeatureFlags,
  type HubspotConfig,
  type HubspotFeatureFlags,
  type HubspotObjectSchema,
  type HubspotOwner,
} from "@scouting-platform/integrations";

import { getHubspotDropdownSources } from "../dropdown-values";
import { ServiceError } from "../errors";
import {
  HUBSPOT_CONTACT_EXTERNAL_ID_PROPERTY,
  HUBSPOT_DEAL_EXTERNAL_ID_PROPERTY,
} from "./direct-sync-domain";
import { enqueueHubspotHealthCheckJob } from "./queue";

const REFERENCE_FRESHNESS_MS = 48 * 60 * 60 * 1_000;
const OBJECT_SYNC_FRESHNESS_MS = 48 * 60 * 60 * 1_000;
const WEBHOOK_FRESHNESS_MS = 24 * 60 * 60 * 1_000;
const HEALTH_CHECK_FRESHNESS_MS = 24 * 60 * 60 * 1_000;
export const HUBSPOT_HEALTH_QUEUE_RECOVERY_AFTER_MS = 30 * 1_000;
export const HUBSPOT_HEALTH_RUNNING_TIMEOUT_MS = 15 * 60 * 1_000;
export const HUBSPOT_HEALTH_RECOVERY_BATCH_SIZE = 25;
export const HUBSPOT_HEALTH_LEASE_MS = 2 * 60 * 1_000;
export const HUBSPOT_HEALTH_HEARTBEAT_INTERVAL_MS = 30 * 1_000;

const healthCheckRunSelect = {
  id: true,
  status: true,
  queuedAt: true,
  startedAt: true,
  completedAt: true,
  lastError: true,
} as const;

type HealthCheckRunRecord = Prisma.HubspotHealthCheckRunGetPayload<{
  select: typeof healthCheckRunSelect;
}>;

type StoredPortal = Readonly<{
  id: string;
  portalId: string;
  displayName: string | null;
  healthStatus: PrismaHubspotPortalHealthStatus;
  healthCheckedAt: Date | null;
  healthLastError: string | null;
  healthSummary: Prisma.JsonValue | null;
  lastReferenceSyncAt: Date | null;
  lastObjectSyncAt: Date | null;
  lastWebhookProcessedAt: Date | null;
}>;

type HealthSummary = Readonly<{
  status: HubspotHealthReport["status"];
  blockers: string[];
  requiredActions: string[];
}>;

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function startHealthCheckLeaseHeartbeat(input: {
  healthCheckRunId: string;
  requestedByUserId: string;
  leaseOwner: string;
}): { stop: () => Promise<void>; assertOwned: () => void } {
  let heartbeatError: Error | null = null;
  let inFlight: Promise<void> | null = null;

  const heartbeat = (): void => {
    if (inFlight || heartbeatError) {
      return;
    }

    inFlight = prisma.hubspotHealthCheckRun.updateMany({
      where: {
        id: input.healthCheckRunId,
        requestedByUserId: input.requestedByUserId,
        status: PrismaHubspotHealthCheckRunStatus.RUNNING,
        leaseOwner: input.leaseOwner,
      },
      data: {
        leaseExpiresAt: new Date(Date.now() + HUBSPOT_HEALTH_LEASE_MS),
      },
    }).then((updated) => {
      if (updated.count === 0) {
        heartbeatError = new Error("HubSpot health check lease ownership was lost");
      }
    }).catch((error: unknown) => {
      heartbeatError = new Error(
        `HubSpot health check lease heartbeat failed: ${safeMessage(error)}`,
      );
    }).finally(() => {
      inFlight = null;
    });
  };

  const timer = setInterval(heartbeat, HUBSPOT_HEALTH_HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      await inFlight;
    },
    assertOwned: () => {
      if (heartbeatError) {
        throw heartbeatError;
      }
    },
  };
}

function fromPrismaHealthStatus(
  status: PrismaHubspotPortalHealthStatus,
): HubspotHealthReport["status"] {
  switch (status) {
    case PrismaHubspotPortalHealthStatus.HEALTHY:
      return "healthy";
    case PrismaHubspotPortalHealthStatus.DEGRADED:
      return "degraded";
    case PrismaHubspotPortalHealthStatus.UNHEALTHY:
      return "unhealthy";
    default:
      return "unknown";
  }
}

function toPrismaHealthStatus(
  status: HubspotHealthReport["status"],
): PrismaHubspotPortalHealthStatus {
  switch (status) {
    case "healthy":
      return PrismaHubspotPortalHealthStatus.HEALTHY;
    case "degraded":
      return PrismaHubspotPortalHealthStatus.DEGRADED;
    case "unhealthy":
      return PrismaHubspotPortalHealthStatus.UNHEALTHY;
    default:
      return PrismaHubspotPortalHealthStatus.UNKNOWN;
  }
}

function toHealthCheckRunStatus(
  status: PrismaHubspotHealthCheckRunStatus,
): HubspotHealthCheckRun["status"] {
  switch (status) {
    case PrismaHubspotHealthCheckRunStatus.RUNNING:
      return "running";
    case PrismaHubspotHealthCheckRunStatus.COMPLETED:
      return "completed";
    case PrismaHubspotHealthCheckRunStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

function toHealthCheckRun(run: HealthCheckRunRecord): HubspotHealthCheckRun {
  return hubspotHealthCheckRunSchema.parse({
    id: run.id,
    status: toHealthCheckRunStatus(run.status),
    queuedAt: run.queuedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    lastError: run.lastError,
  });
}

export function summarizeHubspotHealth(checks: readonly HubspotHealthCheck[]): HealthSummary {
  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warning");

  return {
    status: failed.length > 0 ? "unhealthy" : warnings.length > 0 ? "degraded" : "healthy",
    blockers: failed.map((check) => check.message),
    requiredActions: warnings.map((check) => check.message),
  };
}

async function requireAdmin(requestedByUserId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: requestedByUserId },
    select: { role: true },
  });

  if (!user) {
    throw new ServiceError("USER_NOT_FOUND", 404, "User not found");
  }

  if (user.role !== Role.ADMIN) {
    throw new ServiceError("HUBSPOT_HEALTH_FORBIDDEN", 403, "Forbidden");
  }
}

async function findStoredPortal(portalId?: string | null): Promise<StoredPortal | null> {
  return prisma.hubspotPortal.findFirst({
    ...(portalId ? { where: { portalId } } : {}),
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      portalId: true,
      displayName: true,
      healthStatus: true,
      healthCheckedAt: true,
      healthLastError: true,
      healthSummary: true,
      lastReferenceSyncAt: true,
      lastObjectSyncAt: true,
      lastWebhookProcessedAt: true,
    },
  });
}

function safeFeatureFlags(): HubspotFeatureFlags {
  try {
    return loadHubspotFeatureFlags();
  } catch {
    return {
      directSync: false,
      webhooks: false,
      webhookJournal: false,
      uiExtensions: false,
    };
  }
}

function emptyReport(input: {
  portal: StoredPortal | null;
  flags: HubspotFeatureFlags;
}): HubspotHealthReport {
  const stored = hubspotHealthReportSchema.safeParse(input.portal?.healthSummary);

  if (stored.success) {
    return stored.data;
  }

  return {
    status: input.portal ? fromPrismaHealthStatus(input.portal.healthStatus) : "unknown",
    portalId: input.portal?.portalId ?? null,
    displayName: input.portal?.displayName ?? null,
    directSyncEnabled: input.flags.directSync,
    webhooksEnabled: input.flags.webhooks,
    checkedAt: input.portal?.healthCheckedAt?.toISOString() ?? null,
    lastReferenceSyncAt: input.portal?.lastReferenceSyncAt?.toISOString() ?? null,
    lastObjectSyncAt: input.portal?.lastObjectSyncAt?.toISOString() ?? null,
    lastWebhookProcessedAt: input.portal?.lastWebhookProcessedAt?.toISOString() ?? null,
    checks: [
      {
        code: "saved-health",
        label: "Saved health report",
        status: "skipped",
        message: "No saved HubSpot health check is available yet",
      },
    ],
    blockers: [],
    requiredActions: ["Run the HubSpot connection health check"],
    lastError: input.portal?.healthLastError ?? null,
  };
}

async function loadHubspotHealthReport(): Promise<HubspotHealthReport> {
  const latestCompletedRun = await prisma.hubspotHealthCheckRun.findFirst({
    where: {
      status: PrismaHubspotHealthCheckRunStatus.COMPLETED,
    },
    orderBy: { completedAt: "desc" },
    select: { report: true },
  });
  const completedRunReport = hubspotHealthReportSchema.safeParse(
    latestCompletedRun?.report,
  );

  if (completedRunReport.success) {
    return completedRunReport.data;
  }

  const configuredPortalId = process.env.HUBSPOT_PORTAL_ID?.trim() || null;
  const portal = await findStoredPortal(configuredPortalId);

  return hubspotHealthReportSchema.parse(
    emptyReport({ portal, flags: safeFeatureFlags() }),
  );
}

async function loadHubspotHealthState(): Promise<HubspotHealthState> {
  const latestRun = await prisma.hubspotHealthCheckRun.findFirst({
    orderBy: { createdAt: "desc" },
    select: {
      ...healthCheckRunSelect,
      report: true,
    },
  });
  const latestRunReport = hubspotHealthReportSchema.safeParse(
    latestRun?.status === PrismaHubspotHealthCheckRunStatus.COMPLETED
      ? latestRun.report
      : undefined,
  );
  const report = latestRunReport.success
    ? latestRunReport.data
    : await loadHubspotHealthReport();

  return hubspotHealthStateSchema.parse({
    ...report,
    latestRun: latestRun ? toHealthCheckRun(latestRun) : null,
  });
}

export async function getHubspotHealthReport(input: {
  requestedByUserId: string;
}): Promise<HubspotHealthReport> {
  await requireAdmin(input.requestedByUserId);
  return loadHubspotHealthReport();
}

export async function getHubspotHealthState(input: {
  requestedByUserId: string;
}): Promise<HubspotHealthState> {
  await requireAdmin(input.requestedByUserId);
  return loadHubspotHealthState();
}

export async function requestHubspotHealthCheck(input: {
  requestedByUserId: string;
}): Promise<HubspotHealthState> {
  await requireAdmin(input.requestedByUserId);
  let healthCheckRunId = "";

  await withDbTransaction(async (tx) => {
    const run = await tx.hubspotHealthCheckRun.create({
      data: {
        requestedByUserId: input.requestedByUserId,
      },
      select: { id: true },
    });
    healthCheckRunId = run.id;

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "hubspot_health.requested",
        entityType: "hubspot_health_check_run",
        entityId: run.id,
        metadata: toJsonValue({
          readOnly: true,
          execution: "queued",
        }),
      },
    });
  });

  try {
    await enqueueHubspotHealthCheckJob({
      healthCheckRunId,
      requestedByUserId: input.requestedByUserId,
    });
  } catch (error) {
    const completedAt = new Date();
    const message = `Failed to enqueue HubSpot health check: ${safeMessage(error)}`;

    await withDbTransaction(async (tx) => {
      const failed = await tx.hubspotHealthCheckRun.updateMany({
        where: {
          id: healthCheckRunId,
          status: PrismaHubspotHealthCheckRunStatus.QUEUED,
        },
        data: {
          status: PrismaHubspotHealthCheckRunStatus.FAILED,
          completedAt,
          lastError: message,
        },
      });

      if (failed.count > 0) {
        await tx.auditEvent.create({
          data: {
            actorUserId: input.requestedByUserId,
            action: "hubspot_health.failed",
            entityType: "hubspot_health_check_run",
            entityId: healthCheckRunId,
            metadata: toJsonValue({
              phase: "enqueue",
              lastError: message,
            }),
          },
        });
      }
    });

    throw new ServiceError(
      "HUBSPOT_HEALTH_ENQUEUE_FAILED",
      503,
      "The HubSpot health check could not be queued",
    );
  }

  return loadHubspotHealthState();
}

export async function recoverHubspotHealthCheckRuns(input: {
  enqueue: (payload: {
    healthCheckRunId: string;
    requestedByUserId: string;
  }) => Promise<void>;
  now?: Date;
  queuedRecoveryAfterMs?: number;
  runningTimeoutMs?: number;
  batchSize?: number;
}): Promise<{ requeued: number; enqueueFailed: number; timedOut: number }> {
  const now = input.now ?? new Date();
  const queuedBefore = new Date(
    now.getTime()
      - (input.queuedRecoveryAfterMs ?? HUBSPOT_HEALTH_QUEUE_RECOVERY_AFTER_MS),
  );
  const runningBefore = new Date(
    now.getTime() - (input.runningTimeoutMs ?? HUBSPOT_HEALTH_RUNNING_TIMEOUT_MS),
  );
  const batchSize = input.batchSize ?? HUBSPOT_HEALTH_RECOVERY_BATCH_SIZE;
  const staleRunning = await prisma.hubspotHealthCheckRun.findMany({
    where: {
      status: PrismaHubspotHealthCheckRunStatus.RUNNING,
      OR: [
        { leaseExpiresAt: { lte: now } },
        {
          leaseExpiresAt: null,
          OR: [
            { startedAt: null },
            { startedAt: { lte: runningBefore } },
          ],
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    select: {
      id: true,
      requestedByUserId: true,
    },
  });
  let timedOut = 0;

  for (const run of staleRunning) {
    await withDbTransaction(async (tx) => {
      const message = "HubSpot health check exceeded the worker execution timeout";
      const failed = await tx.hubspotHealthCheckRun.updateMany({
        where: {
          id: run.id,
          status: PrismaHubspotHealthCheckRunStatus.RUNNING,
          OR: [
            { leaseExpiresAt: { lte: now } },
            {
              leaseExpiresAt: null,
              OR: [
                { startedAt: null },
                { startedAt: { lte: runningBefore } },
              ],
            },
          ],
        },
        data: {
          status: PrismaHubspotHealthCheckRunStatus.FAILED,
          completedAt: now,
          lastError: message,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });

      if (failed.count > 0) {
        timedOut += 1;
        await tx.auditEvent.create({
          data: {
            actorUserId: run.requestedByUserId,
            action: "hubspot_health.failed",
            entityType: "hubspot_health_check_run",
            entityId: run.id,
            metadata: toJsonValue({
              phase: "execution_timeout",
              lastError: message,
            }),
          },
        });
      }
    });
  }

  const queuedRuns = await prisma.hubspotHealthCheckRun.findMany({
    where: {
      status: PrismaHubspotHealthCheckRunStatus.QUEUED,
      queuedAt: { lte: queuedBefore },
    },
    orderBy: { queuedAt: "asc" },
    take: batchSize,
    select: {
      id: true,
      requestedByUserId: true,
    },
  });
  let requeued = 0;
  let enqueueFailed = 0;

  for (const run of queuedRuns) {
    try {
      await input.enqueue({
        healthCheckRunId: run.id,
        requestedByUserId: run.requestedByUserId,
      });
      requeued += 1;
      await prisma.hubspotHealthCheckRun.updateMany({
        where: {
          id: run.id,
          status: PrismaHubspotHealthCheckRunStatus.QUEUED,
        },
        data: { lastError: null },
      });
    } catch (error) {
      enqueueFailed += 1;
      await prisma.hubspotHealthCheckRun.updateMany({
        where: {
          id: run.id,
          status: PrismaHubspotHealthCheckRunStatus.QUEUED,
        },
        data: {
          lastError: `Health-check queue recovery failed: ${safeMessage(error)}`,
        },
      });
    }
  }

  return { requeued, enqueueFailed, timedOut };
}

const ACTIVE_DIRECT_BATCH_STATUSES = [
  PrismaHubspotImportBatchStatus.QUEUED,
  PrismaHubspotImportBatchStatus.PREPARING,
  PrismaHubspotImportBatchStatus.RUNNING,
  PrismaHubspotImportBatchStatus.SUBMITTING,
  PrismaHubspotImportBatchStatus.SUBMITTED,
  PrismaHubspotImportBatchStatus.PROCESSING,
] as const;

export async function getHubspotReadiness(input: {
  requestedByUserId: string;
  role: "admin" | "user";
  runId: string;
}): Promise<HubspotReadiness> {
  const run = await prisma.runRequest.findUnique({
    where: { id: input.runId },
    select: { requestedByUserId: true },
  });

  if (!run) {
    throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found");
  }

  if (input.role !== "admin" && run.requestedByUserId !== input.requestedByUserId) {
    throw new ServiceError("RUN_FORBIDDEN", 403, "Forbidden");
  }

  const flags = safeFeatureFlags();
  const configuredPortalId = process.env.HUBSPOT_PORTAL_ID?.trim() || null;
  const portal = await findStoredPortal(configuredPortalId);
  const savedReport = hubspotHealthReportSchema.safeParse(portal?.healthSummary);
  const healthStatus = savedReport.success
    ? savedReport.data.status
    : portal
      ? fromPrismaHealthStatus(portal.healthStatus)
      : "unknown";
  const blockers = savedReport.success ? [...savedReport.data.blockers] : [];

  if (!flags.directSync) {
    blockers.push("Direct HubSpot synchronization is disabled");
  }

  if (!portal || !savedReport.success) {
    blockers.push("An administrator must run the HubSpot connection health check");
  } else if (
    !portal.healthCheckedAt
    || Date.now() - portal.healthCheckedAt.getTime() > HEALTH_CHECK_FRESHNESS_MS
  ) {
    blockers.push("The HubSpot connection health check is stale; an administrator must rerun it");
  } else if (healthStatus !== "healthy") {
    blockers.push(
      ...savedReport.data.requiredActions,
      `HubSpot connection health is ${healthStatus}`,
    );
  }

  const activeBatch = await prisma.hubspotImportBatch.findFirst({
    where: {
      runRequestId: input.runId,
      deliveryMode: PrismaHubspotDeliveryMode.DIRECT_OBJECT_API,
      status: { in: [...ACTIVE_DIRECT_BATCH_STATUSES] },
      ...(input.role === "admin"
        ? {}
        : { requestedByUserId: input.requestedByUserId }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];

  return hubspotReadinessSchema.parse({
    enabled: flags.directSync,
    ready:
      flags.directSync &&
      healthStatus === "healthy" &&
      uniqueBlockers.length === 0,
    healthStatus,
    portalId: portal?.portalId ?? null,
    blockers: uniqueBlockers,
    activeBatchId: activeBatch?.id ?? null,
  });
}

function addCheck(
  checks: HubspotHealthCheck[],
  check: HubspotHealthCheck,
): void {
  checks.push(check);
}

function propertyNames(schema: HubspotObjectSchema): Set<string> {
  return new Set(
    schema.properties
      .map((property) => property.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0),
  );
}

function findObjectSchema(
  schemas: readonly HubspotObjectSchema[],
  objectType: string,
): HubspotObjectSchema | null {
  return (
    schemas.find(
      (schema) =>
        schema.objectTypeId === objectType ||
        schema.fullyQualifiedName === objectType ||
        schema.name === objectType,
    ) ?? null
  );
}

async function checkUniqueProperty(input: {
  checks: HubspotHealthCheck[];
  objectType: "contacts" | "deals";
  propertyName: string;
}): Promise<void> {
  const code = `${input.objectType}-unique-id`;
  const label = `${input.objectType === "contacts" ? "Contact" : "Deal"} unique ID`;

  try {
    const definition = await fetchHubspotPropertyDefinition({
      objectType: input.objectType,
      propertyName: input.propertyName,
    });
    const valid = definition.hasUniqueValue && !definition.archived;
    addCheck(input.checks, {
      code,
      label,
      status: valid ? "pass" : "fail",
      message: valid
        ? `${input.propertyName} is available and unique`
        : `${input.propertyName} must exist as an active unique HubSpot property`,
    });
  } catch (error) {
    const message =
      isHubspotError(error) && error.status === 404
        ? `${input.propertyName} does not exist on HubSpot ${input.objectType}`
        : `${input.propertyName} could not be validated: ${safeMessage(error)}`;
    addCheck(input.checks, {
      code,
      label,
      status: "fail",
      message,
    });
  }
}

async function checkDropdownProperties(input: {
  checks: HubspotHealthCheck[];
  activationObjectType: string;
}): Promise<void> {
  try {
    const sources = getHubspotDropdownSources({
      activationObjectType: input.activationObjectType,
    });
    const propertySources = Object.values(sources).filter(
      (source): source is Extract<(typeof sources)[keyof typeof sources], { kind: "property" }> =>
        source.kind === "property",
    );
    const definitions = await Promise.all(
      propertySources.map((source) =>
        fetchHubspotPropertyDefinition({
          objectType: source.objectType,
          propertyName: source.propertyName,
        }),
      ),
    );
    const missingOptions = definitions.filter(
      (definition) => definition.archived || definition.options.length === 0,
    );

    addCheck(input.checks, {
      code: "dropdown-properties",
      label: "Dropdown references",
      status: missingOptions.length === 0 ? "pass" : "warning",
      message:
        missingOptions.length === 0
          ? `${definitions.length} HubSpot enumeration properties are readable with internal values`
          : `${missingOptions.length} HubSpot dropdown properties are archived or have no options`,
      details: {
        propertyCount: definitions.length,
        optionCount: definitions.reduce(
          (total, definition) => total + definition.options.length,
          0,
        ),
      },
    });
  } catch (error) {
    addCheck(input.checks, {
      code: "dropdown-properties",
      label: "Dropdown references",
      status: "fail",
      message: `HubSpot dropdown properties could not be validated: ${safeMessage(error)}`,
    });
  }
}

const REQUIRED_CONTACT_OUTBOUND_PROPERTIES = [
  "email",
  "firstname",
  "lastname",
  "phone",
  "contact_type",
  "platforms",
  "influencer_type",
  "influencer_vertical",
  "country",
  "language",
  "youtube_url",
  "youtube_handle",
  "influencer_url",
  "youtube_followers",
  "youtube_video_median_views",
  "youtube_shorts_median_views",
  "youtube_engagement_rate",
  "influencer_size",
  "worked_with",
] as const;

const REQUIRED_DEAL_OUTBOUND_PROPERTIES = [
  "dealname",
  "pipeline",
  "dealstage",
  "hubspot_owner_id",
  "deal_currency_code",
  "dealtype",
  "activation_type",
  "amount",
  "closedate",
  "createdate",
] as const;

async function checkOutboundProperties(input: {
  checks: HubspotHealthCheck[];
  config: HubspotConfig;
}): Promise<void> {
  try {
    const [contactProperties, dealProperties] = await Promise.all([
      fetchHubspotProperties({ objectType: "contacts" }),
      fetchHubspotProperties({ objectType: "deals" }),
    ]);
    const contactNames = new Set(contactProperties.map((property) => property.name));
    const dealNames = new Set(dealProperties.map((property) => property.name));
    const requiredContacts = [
      input.config.propertyMappings.contactUniqueIdProperty ??
        HUBSPOT_CONTACT_EXTERNAL_ID_PROPERTY,
      ...REQUIRED_CONTACT_OUTBOUND_PROPERTIES,
    ].filter((value): value is string => Boolean(value));
    const requiredDeals = [
      input.config.propertyMappings.dealUniqueIdProperty ??
        HUBSPOT_DEAL_EXTERNAL_ID_PROPERTY,
      ...REQUIRED_DEAL_OUTBOUND_PROPERTIES,
    ].filter((value): value is string => Boolean(value));
    const missing = [
      ...requiredContacts
        .filter((property) => !contactNames.has(property))
        .map((property) => `contacts.${property}`),
      ...requiredDeals
        .filter((property) => !dealNames.has(property))
        .map((property) => `deals.${property}`),
    ];
    addCheck(input.checks, {
      code: "outbound-properties",
      label: "Direct-sync property contract",
      status: missing.length === 0 ? "pass" : "fail",
      message: missing.length === 0
        ? `${requiredContacts.length + requiredDeals.length} outbound HubSpot properties are readable`
        : `Required outbound HubSpot properties are missing: ${missing.join(", ")}`,
      details: { missing },
    });
  } catch (error) {
    addCheck(input.checks, {
      code: "outbound-properties",
      label: "Direct-sync property contract",
      status: "fail",
      message: `Outbound HubSpot properties could not be validated: ${safeMessage(error)}`,
    });
  }
}

async function checkOwners(input: {
  checks: HubspotHealthCheck[];
}): Promise<HubspotOwner[]> {
  try {
    const page = await fetchHubspotOwners({ archived: false, limit: 500 });
    const activeOwners = page.results.filter((owner) => !owner.archived);
    const managerEmails = await prisma.user.findMany({
      where: {
        isActive: true,
        userType: UserType.CAMPAIGN_MANAGER,
      },
      select: { email: true },
    });
    const ownerEmailCounts = new Map<string, number>();

    for (const owner of activeOwners) {
      const email = owner.email?.trim().toLowerCase();
      if (email) {
        ownerEmailCounts.set(email, (ownerEmailCounts.get(email) ?? 0) + 1);
      }
    }

    const unresolvedManagers = managerEmails
      .map((manager) => manager.email.trim().toLowerCase())
      .filter((email) => ownerEmailCounts.get(email) !== 1);

    addCheck(input.checks, {
      code: "owners",
      label: "Owners",
      status:
        activeOwners.length === 0
          ? "fail"
          : unresolvedManagers.length > 0
            ? "warning"
            : "pass",
      message:
        activeOwners.length === 0
          ? "No active HubSpot owners are readable"
          : unresolvedManagers.length > 0
            ? `${unresolvedManagers.length} active campaign managers do not map to exactly one HubSpot owner by email`
            : `${activeOwners.length} active HubSpot owners are readable and campaign managers map unambiguously`,
      details: {
        activeOwnerCount: activeOwners.length,
        unresolvedManagerCount: unresolvedManagers.length,
      },
    });

    return activeOwners;
  } catch (error) {
    addCheck(input.checks, {
      code: "owners",
      label: "Owners",
      status: "fail",
      message: `HubSpot owners could not be read: ${safeMessage(error)}`,
    });
    return [];
  }
}

async function checkPipelines(checks: HubspotHealthCheck[]): Promise<void> {
  try {
    const pipelines = await fetchHubspotPipelines({
      objectType: "deals",
      archived: false,
    });
    const stageCount = pipelines.reduce(
      (count, pipeline) => count + pipeline.stages.filter((stage) => !stage.archived).length,
      0,
    );
    const valid = pipelines.length > 0 && stageCount > 0;
    addCheck(checks, {
      code: "pipelines",
      label: "Deal pipelines and stages",
      status: valid ? "pass" : "fail",
      message: valid
        ? `${pipelines.length} pipelines and ${stageCount} active stages are readable`
        : "At least one active deal pipeline and stage is required",
    });
  } catch (error) {
    addCheck(checks, {
      code: "pipelines",
      label: "Deal pipelines and stages",
      status: "fail",
      message: `HubSpot pipelines could not be read: ${safeMessage(error)}`,
    });
  }
}

async function checkAssociations(input: {
  checks: HubspotHealthCheck[];
  clientObjectType: string;
  campaignObjectType: string;
  dealCampaignAssociationTypeId: number | null;
  dealClientAssociationTypeId: number | null;
  campaignClientAssociationTypeId: number | null;
}): Promise<void> {
  const pairs = [
    {
      fromObjectType: "contacts",
      toObjectType: "deals",
      preferredLabel: "Scouted creator",
      configuredTypeId: null,
      displayLabel: "Contact → Deal association",
    },
    {
      fromObjectType: "deals",
      toObjectType: input.campaignObjectType,
      preferredLabel: null,
      configuredTypeId: input.dealCampaignAssociationTypeId,
      displayLabel: "Deal → Campaign association",
    },
    {
      fromObjectType: "deals",
      toObjectType: input.clientObjectType,
      preferredLabel: null,
      configuredTypeId: input.dealClientAssociationTypeId,
      displayLabel: "Deal → Client association",
    },
    {
      fromObjectType: input.campaignObjectType,
      toObjectType: input.clientObjectType,
      preferredLabel: null,
      configuredTypeId: input.campaignClientAssociationTypeId,
      displayLabel: "Campaign → Client association",
    },
  ] as const;

  for (const pair of pairs) {
    const { fromObjectType, toObjectType } = pair;
    const code = `association:${fromObjectType}:${toObjectType}`;
    try {
      const labels = await fetchHubspotAssociationLabels({
        fromObjectType,
        toObjectType,
      });
      const configured = pair.configuredTypeId
        ? labels.filter((label) => label.typeId === pair.configuredTypeId)
        : [];
      const preferred = pair.preferredLabel
        ? labels.filter(
            (label) =>
              label.label?.trim().toLowerCase() ===
              pair.preferredLabel?.toLowerCase(),
          )
        : [];
      const defaults = labels.filter((label) => label.label === null);
      const candidates =
        pair.configuredTypeId !== null
          ? configured
          : preferred.length > 0
            ? preferred
            : labels.length === 1
              ? labels
              : defaults.length === 1
                ? defaults
                : [];
      const valid =
        candidates.length === 1 && candidates[0]?.category !== "WORK";
      addCheck(input.checks, {
        code,
        label: pair.displayLabel,
        status: valid ? "pass" : "fail",
        message: valid
          ? `${pair.displayLabel} resolves to directional type ${candidates[0]!.typeId}`
          : `${pair.displayLabel} is missing or ambiguous; create or select it in HubSpot, then run Sync from HubSpot`,
      });
    } catch (error) {
      addCheck(input.checks, {
        code,
        label: pair.displayLabel,
        status: "fail",
        message: `${pair.displayLabel} could not be validated: ${safeMessage(error)}`,
      });
    }
  }
}

function freshnessCheck(input: {
  code: string;
  label: string;
  value: Date | null;
  now: Date;
  maximumAgeMs: number;
  disabled?: boolean;
}): HubspotHealthCheck {
  if (input.disabled) {
    return {
      code: input.code,
      label: input.label,
      status: "skipped",
      message: `${input.label} is disabled by feature configuration`,
    };
  }

  const fresh =
    input.value !== null &&
    input.now.getTime() - input.value.getTime() <= input.maximumAgeMs;

  return {
    code: input.code,
    label: input.label,
    status: fresh ? "pass" : "warning",
    message: fresh
      ? `${input.label} is recent`
      : input.value
        ? `${input.label} is stale; run reconciliation`
        : `${input.label} has not completed yet`,
  };
}

function customSchemaCheck(input: {
  schemas: readonly HubspotObjectSchema[];
  config: HubspotConfig;
}): HubspotHealthCheck {
  const clientObjectType = input.config.objectMappings.clientObjectType;
  const campaignObjectType = input.config.objectMappings.campaignObjectType;
  const activationObjectType = input.config.objectMappings.activationObjectType;

  if (!clientObjectType || !campaignObjectType || !activationObjectType) {
    return {
      code: "custom-object-schemas",
      label: "Client and campaign schemas",
      status: "fail",
      message: "HUBSPOT_CLIENT_OBJECT_TYPE, HUBSPOT_CAMPAIGN_OBJECT_TYPE, and HUBSPOT_ACTIVATION_OBJECT_TYPE are required",
    };
  }

  const clientSchema = findObjectSchema(input.schemas, clientObjectType);
  const campaignSchema = findObjectSchema(input.schemas, campaignObjectType);
  const activationSchema = findObjectSchema(input.schemas, activationObjectType);

  if (
    !clientSchema
    || !campaignSchema
    || !activationSchema
    || clientSchema.archived
    || campaignSchema.archived
    || activationSchema.archived
  ) {
    return {
      code: "custom-object-schemas",
      label: "Client and campaign schemas",
      status: "fail",
      message: "Configured active client, campaign, and activation custom object schemas were not found",
    };
  }

  const clientProperties = propertyNames(clientSchema);
  const campaignProperties = propertyNames(campaignSchema);
  const activationProperties = propertyNames(activationSchema);
  const requiredClientProperties = [
    input.config.propertyMappings.clientNameProperty,
    input.config.propertyMappings.clientDomainProperty,
    input.config.propertyMappings.clientCountryRegionProperty,
    input.config.propertyMappings.clientCityProperty,
    input.config.propertyMappings.clientActiveProperty,
  ].filter((value): value is string => Boolean(value));
  const requiredCampaignProperties = [
    input.config.propertyMappings.campaignNameProperty,
    input.config.propertyMappings.campaignClientObjectIdProperty,
    input.config.propertyMappings.campaignMarketProperty,
    input.config.propertyMappings.campaignBriefLinkProperty,
    input.config.propertyMappings.campaignMonthProperty,
    input.config.propertyMappings.campaignYearProperty,
    input.config.propertyMappings.campaignStatusProperty,
    input.config.propertyMappings.campaignActiveProperty,
  ].filter((value): value is string => Boolean(value));
  const requiredActivationProperties = [
    input.config.propertyMappings.activationNameProperty,
    input.config.propertyMappings.activationTypeProperty,
    input.config.propertyMappings.activationUrlProperty,
    input.config.propertyMappings.activationPublicationDateProperty,
  ].filter((value): value is string => Boolean(value));
  const missing = [
    ...requiredClientProperties.filter((property) => !clientProperties.has(property)),
    ...requiredCampaignProperties.filter((property) => !campaignProperties.has(property)),
    ...requiredActivationProperties.filter((property) => !activationProperties.has(property)),
  ];
  const relationshipAmbiguous = Boolean(
    input.config.propertyMappings.campaignClientObjectIdProperty &&
      input.config.associationMappings.campaignClientAssociationTypeId,
  );
  const mappingMissing =
    !input.config.propertyMappings.clientNameProperty ||
    !input.config.propertyMappings.campaignNameProperty ||
    !input.config.propertyMappings.campaignStatusProperty ||
    !input.config.propertyMappings.activationNameProperty ||
    (!input.config.propertyMappings.campaignClientObjectIdProperty &&
      !input.config.associationMappings.campaignClientAssociationTypeId);

  return {
    code: "custom-object-schemas",
    label: "Client and campaign schemas",
    status:
      missing.length === 0 && !mappingMissing && !relationshipAmbiguous
        ? "pass"
        : "fail",
    message:
      missing.length === 0 && !mappingMissing && !relationshipAmbiguous
        ? "Configured client/campaign/activation schemas and required properties are readable"
        : relationshipAmbiguous
          ? "Configure either the campaign client-ID property or association type, not both"
        : mappingMissing
          ? "Required client/campaign property mappings are not configured"
          : `Configured custom object properties are missing: ${missing.join(", ")}`,
  };
}

async function persistHealthReport(input: {
  healthCheckRunId: string;
  requestedByUserId: string;
  leaseOwner: string;
  portalId: string | null;
  displayName: string | null;
  report: HubspotHealthReport;
  completedAt: Date;
}): Promise<void> {
  await withDbTransaction(async (tx) => {
    let entityId = input.portalId ?? "unconfigured";

    if (input.portalId) {
      const portal = await tx.hubspotPortal.upsert({
        where: { portalId: input.portalId },
        create: {
          portalId: input.portalId,
          displayName: input.displayName,
          healthStatus: toPrismaHealthStatus(input.report.status),
          healthCheckedAt: input.report.checkedAt ? new Date(input.report.checkedAt) : null,
          healthLastError: input.report.lastError,
          healthSummary: toJsonValue(input.report),
        },
        update: {
          ...(input.displayName === null ? {} : { displayName: input.displayName }),
          healthStatus: toPrismaHealthStatus(input.report.status),
          healthCheckedAt: input.report.checkedAt ? new Date(input.report.checkedAt) : null,
          healthLastError: input.report.lastError,
          healthSummary: toJsonValue(input.report),
        },
        select: { id: true },
      });
      entityId = portal.id;
    }

    const completedRun = await tx.hubspotHealthCheckRun.updateMany({
      where: {
        id: input.healthCheckRunId,
        requestedByUserId: input.requestedByUserId,
        status: PrismaHubspotHealthCheckRunStatus.RUNNING,
        leaseOwner: input.leaseOwner,
      },
      data: {
        status: PrismaHubspotHealthCheckRunStatus.COMPLETED,
        report: toJsonValue(input.report),
        completedAt: input.completedAt,
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    if (completedRun.count === 0) {
      throw new ServiceError(
        "HUBSPOT_HEALTH_RUN_STATE_INVALID",
        409,
        "HubSpot health check run is no longer running",
      );
    }

    await tx.auditEvent.create({
      data: {
        actorUserId: input.requestedByUserId,
        action: "hubspot_health.checked",
        entityType: "hubspot_portal",
        entityId,
        metadata: toJsonValue({
          status: input.report.status,
          healthCheckRunId: input.healthCheckRunId,
          portalId: input.portalId,
          blockerCount: input.report.blockers.length,
          warningCount: input.report.requiredActions.length,
          checkStatuses: input.report.checks.map((check) => ({
            code: check.code,
            status: check.status,
          })),
        }),
      },
    });
  });
}

type CollectedHubspotHealth = Readonly<{
  portalId: string | null;
  displayName: string | null;
  report: HubspotHealthReport;
}>;

async function collectHubspotHealthCheck(input: {
  now?: Date;
}): Promise<CollectedHubspotHealth> {
  const now = input.now ?? new Date();
  const checks: HubspotHealthCheck[] = [];
  let flags = safeFeatureFlags();
  let config: HubspotConfig | null = null;
  let portalId = process.env.HUBSPOT_PORTAL_ID?.trim() || null;
  let displayName: string | null = null;

  try {
    config = loadHubspotConfig();
    flags = config.featureFlags;
    addCheck(checks, {
      code: "configuration",
      label: "Server configuration",
      status: "pass",
      message: "HubSpot server configuration is valid",
    });
  } catch (error) {
    addCheck(checks, {
      code: "configuration",
      label: "Server configuration",
      status: "fail",
      message: `HubSpot server configuration is invalid: ${safeMessage(error)}`,
    });
  }

  if (config) {
    try {
      const identity = await fetchHubspotAccountIdentity();
      portalId = identity.portalId;
      displayName = identity.uiDomain ?? null;
      const portalMatches = !config.portalId || config.portalId === identity.portalId;
      addCheck(checks, {
        code: "account-identity",
        label: "Token and portal identity",
        status: portalMatches ? "pass" : "fail",
        message: portalMatches
          ? `Authenticated to HubSpot portal ${identity.portalId}`
          : `Authenticated portal ${identity.portalId} does not match configured portal ${config.portalId}`,
        details: { portalId: identity.portalId },
      });
    } catch (error) {
      addCheck(checks, {
        code: "account-identity",
        label: "Token and portal identity",
        status: "fail",
        message: `HubSpot token/account identity could not be validated: ${safeMessage(error)}`,
      });
    }

    await Promise.all([
      checkUniqueProperty({
        checks,
        objectType: "contacts",
        propertyName:
          config.propertyMappings.contactUniqueIdProperty ??
          HUBSPOT_CONTACT_EXTERNAL_ID_PROPERTY,
      }),
      checkUniqueProperty({
        checks,
        objectType: "deals",
        propertyName:
          config.propertyMappings.dealUniqueIdProperty ??
          HUBSPOT_DEAL_EXTERNAL_ID_PROPERTY,
      }),
    ]);
    await checkOutboundProperties({ checks, config });

    try {
      const schemas = await fetchHubspotObjectSchemas();
      addCheck(checks, customSchemaCheck({ schemas, config }));
    } catch (error) {
      addCheck(checks, {
        code: "custom-object-schemas",
        label: "Client and campaign schemas",
        status: "fail",
        message: `HubSpot custom object schemas could not be read: ${safeMessage(error)}`,
      });
    }

    if (config.objectMappings.activationObjectType) {
      await checkDropdownProperties({
        checks,
        activationObjectType: config.objectMappings.activationObjectType,
      });
    } else {
      addCheck(checks, {
        code: "dropdown-properties",
        label: "Dropdown references",
        status: "fail",
        message: "HUBSPOT_ACTIVATION_OBJECT_TYPE is required to validate dropdown properties",
      });
    }

    await checkOwners({ checks });
    await checkPipelines(checks);

    if (
      config.objectMappings.clientObjectType &&
      config.objectMappings.campaignObjectType
    ) {
      await checkAssociations({
        checks,
        clientObjectType: config.objectMappings.clientObjectType,
        campaignObjectType: config.objectMappings.campaignObjectType,
        dealCampaignAssociationTypeId:
          config.associationMappings.dealCampaignAssociationTypeId,
        dealClientAssociationTypeId:
          config.associationMappings.dealClientAssociationTypeId,
        campaignClientAssociationTypeId:
          config.associationMappings.campaignClientAssociationTypeId,
      });
    } else {
      addCheck(checks, {
        code: "association-configuration",
        label: "Association configuration",
        status: "fail",
        message: "Custom object types are required to validate associations",
      });
    }
  } else {
    for (const [code, label] of [
      ["account-identity", "Token and portal identity"],
      ["provider-schema", "HubSpot schema and references"],
    ] as const) {
      addCheck(checks, {
        code,
        label,
        status: "skipped",
        message: `${label} was skipped because server configuration is invalid`,
      });
    }
  }

  const portal = await findStoredPortal(portalId);
  addCheck(checks, {
    code: "direct-sync-flag",
    label: "Direct sync feature",
    status: flags.directSync ? "pass" : "warning",
    message: flags.directSync
      ? "Direct HubSpot synchronization is enabled"
      : "Direct HubSpot synchronization is disabled",
  });
  addCheck(
    checks,
    freshnessCheck({
      code: "reference-sync-recency",
      label: "Reference synchronization",
      value: portal?.lastReferenceSyncAt ?? null,
      now,
      maximumAgeMs: REFERENCE_FRESHNESS_MS,
    }),
  );
  addCheck(
    checks,
    freshnessCheck({
      code: "object-sync-recency",
      label: "Client/campaign reconciliation",
      value: portal?.lastObjectSyncAt ?? null,
      now,
      maximumAgeMs: OBJECT_SYNC_FRESHNESS_MS,
    }),
  );
  addCheck(
    checks,
    freshnessCheck({
      code: "webhook-recency",
      label: "Webhook processing",
      value: portal?.lastWebhookProcessedAt ?? null,
      now,
      maximumAgeMs: WEBHOOK_FRESHNESS_MS,
      disabled: !flags.webhooks,
    }),
  );

  const summary = summarizeHubspotHealth(checks);
  const lastError = summary.blockers.length > 0 ? summary.blockers.join("; ") : null;
  const report = hubspotHealthReportSchema.parse({
    status: summary.status,
    portalId,
    displayName: displayName ?? portal?.displayName ?? null,
    directSyncEnabled: flags.directSync,
    webhooksEnabled: flags.webhooks,
    checkedAt: now.toISOString(),
    lastReferenceSyncAt: portal?.lastReferenceSyncAt?.toISOString() ?? null,
    lastObjectSyncAt: portal?.lastObjectSyncAt?.toISOString() ?? null,
    lastWebhookProcessedAt: portal?.lastWebhookProcessedAt?.toISOString() ?? null,
    checks,
    blockers: summary.blockers,
    requiredActions: summary.requiredActions,
    lastError,
  });

  return {
    portalId,
    displayName: report.displayName,
    report,
  };
}

async function markHealthCheckRunFailed(input: {
  healthCheckRunId: string;
  requestedByUserId: string;
  leaseOwner?: string;
  message: string;
  completedAt: Date;
  phase: "authorization" | "execution";
}): Promise<void> {
  await withDbTransaction(async (tx) => {
    const failed = await tx.hubspotHealthCheckRun.updateMany({
      where: {
        id: input.healthCheckRunId,
        requestedByUserId: input.requestedByUserId,
        ...(input.leaseOwner ? { leaseOwner: input.leaseOwner } : {}),
        status: {
          in: [
            PrismaHubspotHealthCheckRunStatus.QUEUED,
            PrismaHubspotHealthCheckRunStatus.RUNNING,
          ],
        },
      },
      data: {
        status: PrismaHubspotHealthCheckRunStatus.FAILED,
        completedAt: input.completedAt,
        lastError: input.message,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    if (failed.count > 0) {
      await tx.auditEvent.create({
        data: {
          actorUserId: input.requestedByUserId,
          action: "hubspot_health.failed",
          entityType: "hubspot_health_check_run",
          entityId: input.healthCheckRunId,
          metadata: toJsonValue({
            phase: input.phase,
            lastError: input.message,
          }),
        },
      });
    }
  });
}

async function loadHealthCheckRunById(
  healthCheckRunId: string,
): Promise<HealthCheckRunRecord & { requestedByUserId: string }> {
  const run = await prisma.hubspotHealthCheckRun.findUnique({
    where: { id: healthCheckRunId },
    select: {
      ...healthCheckRunSelect,
      requestedByUserId: true,
    },
  });

  if (!run) {
    throw new ServiceError(
      "HUBSPOT_HEALTH_RUN_NOT_FOUND",
      404,
      "HubSpot health check run not found",
    );
  }

  return run;
}

export async function executeHubspotHealthCheckRun(input: {
  healthCheckRunId: string;
  requestedByUserId: string;
  now?: Date;
}): Promise<HubspotHealthCheckRun> {
  const existing = await loadHealthCheckRunById(input.healthCheckRunId);

  if (existing.requestedByUserId !== input.requestedByUserId) {
    const message = "HubSpot health check actor does not match the persisted requester";
    await markHealthCheckRunFailed({
      healthCheckRunId: input.healthCheckRunId,
      requestedByUserId: existing.requestedByUserId,
      message,
      completedAt: input.now ?? new Date(),
      phase: "authorization",
    });
    throw new ServiceError("HUBSPOT_HEALTH_RUN_FORBIDDEN", 403, message);
  }

  if (
    existing.status === PrismaHubspotHealthCheckRunStatus.COMPLETED
    || existing.status === PrismaHubspotHealthCheckRunStatus.FAILED
  ) {
    return toHealthCheckRun(existing);
  }

  if (existing.status === PrismaHubspotHealthCheckRunStatus.RUNNING) {
    throw new ServiceError(
      "HUBSPOT_HEALTH_RUN_ALREADY_RUNNING",
      409,
      "HubSpot health check run is already running",
    );
  }

  const startedAt = input.now ?? new Date();
  const leaseOwner = randomUUID();
  const claimed = await prisma.hubspotHealthCheckRun.updateMany({
    where: {
      id: input.healthCheckRunId,
      requestedByUserId: input.requestedByUserId,
      status: PrismaHubspotHealthCheckRunStatus.QUEUED,
    },
    data: {
      status: PrismaHubspotHealthCheckRunStatus.RUNNING,
      startedAt,
      completedAt: null,
      lastError: null,
      leaseOwner,
      leaseExpiresAt: new Date(startedAt.getTime() + HUBSPOT_HEALTH_LEASE_MS),
    },
  });

  if (claimed.count === 0) {
    const current = await loadHealthCheckRunById(input.healthCheckRunId);

    if (
      current.status === PrismaHubspotHealthCheckRunStatus.COMPLETED
      || current.status === PrismaHubspotHealthCheckRunStatus.FAILED
    ) {
      return toHealthCheckRun(current);
    }

    throw new ServiceError(
      "HUBSPOT_HEALTH_RUN_CLAIM_CONFLICT",
      409,
      "HubSpot health check run could not be claimed",
    );
  }

  const heartbeat = startHealthCheckLeaseHeartbeat({
    healthCheckRunId: input.healthCheckRunId,
    requestedByUserId: input.requestedByUserId,
    leaseOwner,
  });

  try {
    await requireAdmin(input.requestedByUserId);
    const collected = await collectHubspotHealthCheck({
      ...(input.now ? { now: input.now } : {}),
    });
    await heartbeat.stop();
    heartbeat.assertOwned();
    const completedAt = input.now ?? new Date();

    await persistHealthReport({
      healthCheckRunId: input.healthCheckRunId,
      requestedByUserId: input.requestedByUserId,
      leaseOwner,
      portalId: collected.portalId,
      displayName: collected.displayName,
      report: collected.report,
      completedAt,
    });
  } catch (error) {
    await heartbeat.stop();
    const message = safeMessage(error);
    await markHealthCheckRunFailed({
      healthCheckRunId: input.healthCheckRunId,
      requestedByUserId: input.requestedByUserId,
      leaseOwner,
      message,
      completedAt: input.now ?? new Date(),
      phase:
        error instanceof ServiceError && error.code === "HUBSPOT_HEALTH_FORBIDDEN"
          ? "authorization"
          : "execution",
    });
    throw error;
  }

  return toHealthCheckRun(await loadHealthCheckRunById(input.healthCheckRunId));
}
