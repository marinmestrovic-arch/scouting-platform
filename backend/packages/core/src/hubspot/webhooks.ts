import {
  HubspotConflictOwnership as PrismaHubspotConflictOwnership,
  HubspotConflictStatus as PrismaHubspotConflictStatus,
  HubspotWebhookEventStatus as PrismaHubspotWebhookEventStatus,
  Prisma,
} from "@prisma/client";
import {
  hubspotWebhookDeliverySchema,
  type HubspotWebhookAcceptedResponse,
  type HubspotWebhookEventPayload,
} from "@scouting-platform/contracts";
import { prisma, type DbTransactionClient } from "@scouting-platform/db";

import { ServiceError } from "../errors";
import { classifyHubspotPropertyOwnership } from "./direct-sync-domain";
import { enqueueHubspotWebhookJob } from "./queue";
import {
  buildHubspotWebhookDedupeKey,
  shouldApplyHubspotObservation,
} from "./reconciliation-domain";

const WEBHOOK_RETRY_BASE_MS = 30_000;
const WEBHOOK_RETRY_MAX_MS = 30 * 60_000;
const WEBHOOK_MAX_RETRIES = 5;
const WEBHOOK_PROCESSING_LEASE_MS = 5 * 60_000;
const WEBHOOK_TRANSACTION_TIMEOUT_MS = 15_000;
const MIRROR_OBSERVATION_CURSORS_KEY = "__scouting_platform_observation_cursors";

class HubspotWebhookLeaseLostError extends Error {
  constructor() {
    super("HubSpot webhook event processing lease was lost");
    this.name = "HubspotWebhookLeaseLostError";
  }
}

type ObservationCursor = {
  occurredAt: Date;
  tieBreaker: string;
};

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toConflictJsonValue(
  value: string | null,
): string | Prisma.JsonNullValueInput {
  // A cleared CRM property is an observed JSON value, not an absent database
  // snapshot. Prisma.JsonNull preserves that distinction from Prisma.DbNull.
  return value === null ? Prisma.JsonNull : value;
}

function formatError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
}

function deriveObjectType(event: HubspotWebhookEventPayload): string {
  const objectType = event.subscriptionType.split(".")[0]?.trim().toLowerCase();
  if (!objectType) {
    throw new ServiceError(
      "HUBSPOT_WEBHOOK_OBJECT_TYPE_MISSING",
      400,
      "HubSpot webhook object type is missing",
    );
  }

  if (objectType === "object") {
    const objectTypeId = event.objectTypeId?.trim().toLowerCase();

    if (["0-1", "contact", "contacts"].includes(objectTypeId ?? "")) {
      return "contact";
    }

    if (["0-3", "deal", "deals"].includes(objectTypeId ?? "")) {
      return "deal";
    }

    throw new ServiceError(
      objectTypeId
        ? "HUBSPOT_WEBHOOK_OBJECT_TYPE_UNSUPPORTED"
        : "HUBSPOT_WEBHOOK_OBJECT_TYPE_MISSING",
      400,
      objectTypeId
        ? `HubSpot webhook object type ${objectTypeId} is not supported`
        : "HubSpot generic webhook object type ID is missing",
    );
  }

  return objectType;
}

function getEventObjectId(event: HubspotWebhookEventPayload): string {
  const objectId = event.objectId ?? event.primaryObjectId ?? event.newObjectId;
  if (!objectId) {
    throw new ServiceError(
      "HUBSPOT_WEBHOOK_OBJECT_ID_MISSING",
      400,
      "HubSpot webhook object ID is missing",
    );
  }
  return objectId;
}

function safeEventPayload(event: HubspotWebhookEventPayload): Prisma.InputJsonValue {
  return toJsonValue({
    eventId: event.eventId,
    subscriptionId: event.subscriptionId,
    subscriptionType: event.subscriptionType,
    objectTypeId: event.objectTypeId,
    objectId: event.objectId,
    primaryObjectId: event.primaryObjectId,
    newObjectId: event.newObjectId,
    mergedObjectIds: event.mergedObjectIds,
    propertyName: event.propertyName,
    propertyValue: event.propertyValue,
    changeSource: event.changeSource,
    occurredAt: event.occurredAt,
  });
}

export async function acceptHubspotWebhookDelivery(input: {
  expectedPortalId: string;
  events: unknown;
}): Promise<HubspotWebhookAcceptedResponse> {
  const events = hubspotWebhookDeliverySchema.parse(input.events);
  const expectedPortalId = input.expectedPortalId.trim();

  if (!expectedPortalId) {
    throw new ServiceError(
      "HUBSPOT_PORTAL_ID_MISSING",
      500,
      "HUBSPOT_PORTAL_ID is required for webhook processing",
    );
  }

  if (events.some((event) => event.portalId !== expectedPortalId)) {
    throw new ServiceError(
      "HUBSPOT_WEBHOOK_PORTAL_MISMATCH",
      403,
      "HubSpot webhook portal does not match the configured portal",
    );
  }

  const portal = await prisma.hubspotPortal.upsert({
    where: { portalId: expectedPortalId },
    create: { portalId: expectedPortalId },
    update: {},
    select: { id: true },
  });
  const records = events.map((event) => ({
    hubspotPortalId: portal.id,
    dedupeKey: buildHubspotWebhookDedupeKey(event),
    subscriptionType: event.subscriptionType,
    eventType: event.subscriptionType,
    objectType: deriveObjectType(event),
    hubspotObjectId: getEventObjectId(event),
    propertyName: event.propertyName?.trim() || null,
    occurredAt: new Date(event.occurredAt),
    status: PrismaHubspotWebhookEventStatus.RECEIVED,
    safeRawPayload: safeEventPayload(event),
  }));

  const inserted = await prisma.hubspotWebhookEvent.createMany({
    data: records,
    skipDuplicates: true,
  });
  const persisted = await prisma.hubspotWebhookEvent.findMany({
    where: {
      hubspotPortalId: portal.id,
      dedupeKey: { in: records.map((record) => record.dedupeKey) },
      status: {
        in: [
          PrismaHubspotWebhookEventStatus.RECEIVED,
          PrismaHubspotWebhookEventStatus.FAILED,
        ],
      },
      retryCount: { lt: WEBHOOK_MAX_RETRIES },
    },
    select: { id: true, status: true },
  });

  for (const event of persisted) {
    await enqueueHubspotWebhookJob({ webhookEventId: event.id });
    await prisma.hubspotWebhookEvent.updateMany({
      where: {
        id: event.id,
        status: event.status,
      },
      data: {
        status: PrismaHubspotWebhookEventStatus.QUEUED,
        nextRetryAt: null,
      },
    });
  }

  return {
    accepted: inserted.count,
    duplicates: events.length - inserted.count,
  };
}

function jsonScalar(value: Prisma.JsonValue | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (["string", "number", "boolean"].includes(typeof value)) {
    return String(value);
  }
  return JSON.stringify(value);
}

function getLocalContactProperty(input: {
  propertyName: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phoneNumber: string | null;
}): string | null {
  switch (input.propertyName.trim().toLowerCase()) {
    case "email":
      return input.email;
    case "firstname":
      return input.firstName;
    case "lastname":
      return input.lastName;
    case "phone":
      return input.phoneNumber;
    default:
      return null;
  }
}

function ownershipToPrisma(
  ownership: ReturnType<typeof classifyHubspotPropertyOwnership>,
): PrismaHubspotConflictOwnership {
  switch (ownership) {
    case "platform":
      return PrismaHubspotConflictOwnership.PLATFORM;
    case "hubspot":
      return PrismaHubspotConflictOwnership.HUBSPOT;
    default:
      return PrismaHubspotConflictOwnership.SHARED;
  }
}

async function recordContactConflict(db: DbTransactionClient, input: {
  portalId: string;
  contactLinkId: string;
  channelContactId: string;
  hubspotObjectId: string;
  propertyName: string;
  localValue: string | null;
  hubspotValue: string | null;
}): Promise<void> {
  const ownership = classifyHubspotPropertyOwnership(input.propertyName);
  if (ownership === "hubspot") {
    return;
  }

  const normalizedLocal = input.localValue?.trim() || null;
  const normalizedHubspot = input.hubspotValue?.trim() || null;
  if (normalizedLocal === normalizedHubspot) {
    return;
  }

  const dedupeKey = `contact:${input.contactLinkId}:${input.propertyName.toLowerCase()}`;
  await db.hubspotConflict.upsert({
    where: {
      hubspotPortalId_dedupeKey: {
        hubspotPortalId: input.portalId,
        dedupeKey,
      },
    },
    create: {
      hubspotPortalId: input.portalId,
      dedupeKey,
      channelContactId: input.channelContactId,
      hubspotContactLinkId: input.contactLinkId,
      hubspotObjectType: "contacts",
      hubspotObjectId: input.hubspotObjectId,
      propertyName: input.propertyName,
      localValue: toConflictJsonValue(normalizedLocal),
      hubspotValue: toConflictJsonValue(normalizedHubspot),
      ownership: ownershipToPrisma(ownership),
    },
    update: {
      localValue: toConflictJsonValue(normalizedLocal),
      hubspotValue: toConflictJsonValue(normalizedHubspot),
      ownership: ownershipToPrisma(ownership),
      status: PrismaHubspotConflictStatus.OPEN,
      detectedAt: new Date(),
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionAction: null,
      resolutionNote: null,
    },
  });
}

function readSafePayload(
  value: Prisma.JsonValue | null | undefined,
): Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function observationScope(input: {
  subscriptionType: string;
  propertyName: string | null;
}): string {
  const propertyName = input.propertyName?.trim().toLowerCase();
  if (propertyName) {
    return `property:${propertyName}`;
  }

  const subscriptionType = input.subscriptionType.trim().toLowerCase();
  if (
    subscriptionType.includes("deletion")
    || subscriptionType.includes("archive")
    || subscriptionType.includes("restore")
  ) {
    return "object:archive-state";
  }
  if (subscriptionType.includes("merge")) {
    return "object:merge";
  }
  return `event:${subscriptionType}`;
}

function parseObservationCursor(value: Prisma.JsonValue | undefined): ObservationCursor | null {
  if (typeof value === "string") {
    const occurredAt = new Date(value);
    return Number.isNaN(occurredAt.getTime())
      ? null
      : { occurredAt, tieBreaker: "" };
  }
  const cursor = readSafePayload(value);
  const occurredAtValue = cursor.occurredAt;
  const tieBreaker = cursor.tieBreaker;
  if (typeof occurredAtValue !== "string") {
    return null;
  }
  const occurredAt = new Date(occurredAtValue);
  if (Number.isNaN(occurredAt.getTime())) {
    return null;
  }
  return {
    occurredAt,
    tieBreaker: typeof tieBreaker === "string" ? tieBreaker : "",
  };
}

function getObservationCursor(
  mirrorProperties: Prisma.JsonObject,
  scope: string,
): ObservationCursor | null {
  const cursors = readSafePayload(mirrorProperties[MIRROR_OBSERVATION_CURSORS_KEY]);
  return parseObservationCursor(cursors[scope]);
}

function shouldApplyScopedObservation(input: {
  mirrorProperties: Prisma.JsonObject;
  scope: string;
  occurredAt: Date;
  tieBreaker: string;
}): boolean {
  const previous = getObservationCursor(input.mirrorProperties, input.scope);
  if (!previous) {
    return true;
  }
  if (
    !shouldApplyHubspotObservation({
      occurredAt: input.occurredAt,
      lastObservedAt: previous.occurredAt,
    })
  ) {
    return false;
  }
  if (input.occurredAt.getTime() > previous.occurredAt.getTime()) {
    return true;
  }
  return input.tieBreaker >= previous.tieBreaker;
}

function setObservationCursor(input: {
  mirrorProperties: Prisma.JsonObject;
  scope: string;
  occurredAt: Date;
  tieBreaker: string;
}): Prisma.JsonObject {
  const cursors = readSafePayload(
    input.mirrorProperties[MIRROR_OBSERVATION_CURSORS_KEY],
  );
  return {
    ...input.mirrorProperties,
    [MIRROR_OBSERVATION_CURSORS_KEY]: {
      ...cursors,
      [input.scope]: {
        occurredAt: input.occurredAt.toISOString(),
        tieBreaker: input.tieBreaker,
      },
    },
  };
}

function latestObservationAt(current: Date | null, incoming: Date): Date {
  return !current || incoming > current ? incoming : current;
}

function getArchiveState(subscriptionType: string): boolean | undefined {
  const normalizedType = subscriptionType.toLowerCase();
  if (normalizedType.includes("restore") || normalizedType.includes("unarchive")) {
    return false;
  }
  if (normalizedType.includes("deletion") || normalizedType.includes("archive")) {
    return true;
  }
  return undefined;
}

function providerId(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : null;
}

function providerIds(value: Prisma.JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const id = providerId(item);
        return id ? [id] : [];
      })
    : [];
}

function getContactMergeIdentity(input: {
  eventObjectId: string;
  payload: Prisma.JsonObject;
}): { targetId: string; losingIds: string[] } | null {
  const payloadObjectId = providerId(input.payload.objectId);
  const primaryObjectId = providerId(input.payload.primaryObjectId);
  const newObjectId = providerId(input.payload.newObjectId);
  const mergedObjectIds = providerIds(input.payload.mergedObjectIds);
  const targetId = newObjectId
    ?? primaryObjectId
    ?? payloadObjectId
    ?? input.eventObjectId;

  if (!targetId) {
    return null;
  }

  const losingIds = new Set(mergedObjectIds);
  for (const candidate of [
    newObjectId ? primaryObjectId : null,
    payloadObjectId,
    input.eventObjectId,
  ]) {
    if (candidate && candidate !== targetId) {
      losingIds.add(candidate);
    }
  }
  losingIds.delete(targetId);

  return {
    targetId,
    losingIds: [...losingIds].sort(),
  };
}

function withoutMergeTombstone(
  mirrorProperties: Prisma.JsonObject,
): Prisma.JsonObject {
  const activeMirrorProperties = { ...mirrorProperties };
  delete activeMirrorProperties.mergedIntoHubspotObjectId;
  delete activeMirrorProperties.mergedAt;
  return activeMirrorProperties;
}

async function processContactMergeEvent(db: DbTransactionClient, event: {
  hubspotPortalId: string;
  hubspotObjectId: string;
  subscriptionType: string;
  propertyName: string | null;
  occurredAt: Date;
  dedupeKey: string;
  safeRawPayload: Prisma.JsonValue | null;
}): Promise<"completed" | "ignored"> {
  const payload = readSafePayload(event.safeRawPayload);
  const mergeIdentity = getContactMergeIdentity({
    eventObjectId: event.hubspotObjectId,
    payload,
  });
  if (!mergeIdentity || mergeIdentity.losingIds.length === 0) {
    return "ignored";
  }

  const relatedLinks = await db.hubspotContactLink.findMany({
    where: {
      hubspotPortalId: event.hubspotPortalId,
      hubspotObjectId: {
        in: [mergeIdentity.targetId, ...mergeIdentity.losingIds],
      },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      channelContactId: true,
      hubspotObjectId: true,
      lastObservedHubspotUpdatedAt: true,
      mirrorProperties: true,
    },
  });
  if (relatedLinks.length === 0) {
    return "ignored";
  }

  const scope = observationScope(event);
  if (relatedLinks.some((link) => !shouldApplyScopedObservation({
    mirrorProperties: readSafePayload(link.mirrorProperties),
    scope,
    occurredAt: event.occurredAt,
    tieBreaker: event.dedupeKey,
  }))) {
    return "ignored";
  }

  const existingTargetLink = relatedLinks.find(
    (link) => link.hubspotObjectId === mergeIdentity.targetId,
  );
  const losingLinks = relatedLinks.filter(
    (link) => mergeIdentity.losingIds.includes(link.hubspotObjectId),
  );
  if (losingLinks.length === 0) {
    return "ignored";
  }

  // The schema intentionally permits one local link for a HubSpot object.
  // Keep an existing winner when present; otherwise promote the stable
  // lowest-ID losing link. Other links remain as archived merge tombstones.
  const canonicalLink = existingTargetLink ?? losingLinks[0]!;
  const canonicalMirrorProperties = setObservationCursor({
    mirrorProperties: withoutMergeTombstone(
      readSafePayload(canonicalLink.mirrorProperties),
    ),
    scope,
    occurredAt: event.occurredAt,
    tieBreaker: event.dedupeKey,
  });
  await db.hubspotContactLink.update({
    where: { id: canonicalLink.id },
    data: {
      hubspotObjectId: mergeIdentity.targetId,
      lastObservedHubspotUpdatedAt: latestObservationAt(
        canonicalLink.lastObservedHubspotUpdatedAt,
        event.occurredAt,
      ),
      mirrorProperties: toJsonValue(canonicalMirrorProperties),
    },
  });
  await db.hubspotConflict.updateMany({
    where: {
      hubspotContactLinkId: canonicalLink.id,
      status: PrismaHubspotConflictStatus.OPEN,
    },
    data: { hubspotObjectId: mergeIdentity.targetId },
  });

  for (const losingLink of losingLinks) {
    if (losingLink.id === canonicalLink.id) {
      continue;
    }

    await recordContactConflict(db, {
      portalId: event.hubspotPortalId,
      contactLinkId: losingLink.id,
      channelContactId: losingLink.channelContactId,
      hubspotObjectId: mergeIdentity.targetId,
      propertyName: "__merge__",
      localValue: losingLink.hubspotObjectId,
      hubspotValue: mergeIdentity.targetId,
    });
    await db.hubspotConflict.updateMany({
      where: {
        hubspotContactLinkId: losingLink.id,
        status: PrismaHubspotConflictStatus.OPEN,
      },
      data: { hubspotObjectId: mergeIdentity.targetId },
    });
    await db.hubspotContactLink.update({
      where: { id: losingLink.id },
      data: {
        archived: true,
        lastObservedHubspotUpdatedAt: latestObservationAt(
          losingLink.lastObservedHubspotUpdatedAt,
          event.occurredAt,
        ),
        mirrorProperties: toJsonValue(
          setObservationCursor({
            mirrorProperties: {
              ...readSafePayload(losingLink.mirrorProperties),
              mergedIntoHubspotObjectId: mergeIdentity.targetId,
              mergedAt: event.occurredAt.toISOString(),
            },
            scope,
            occurredAt: event.occurredAt,
            tieBreaker: event.dedupeKey,
          }),
        ),
      },
    });
  }

  return "completed";
}

async function processContactEvent(db: DbTransactionClient, event: {
  hubspotPortalId: string;
  hubspotObjectId: string;
  subscriptionType: string;
  propertyName: string | null;
  occurredAt: Date;
  dedupeKey: string;
  safeRawPayload: Prisma.JsonValue | null;
}): Promise<"completed" | "ignored"> {
  const normalizedType = event.subscriptionType.toLowerCase();
  if (normalizedType.includes("merge")) {
    return processContactMergeEvent(db, event);
  }

  const link = await db.hubspotContactLink.findUnique({
    where: {
      hubspotPortalId_hubspotObjectId: {
        hubspotPortalId: event.hubspotPortalId,
        hubspotObjectId: event.hubspotObjectId,
      },
    },
    select: {
      id: true,
      channelContactId: true,
      lastObservedHubspotUpdatedAt: true,
      mirrorProperties: true,
      channelContact: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          phoneNumber: true,
        },
      },
    },
  });

  if (!link) {
    return "ignored";
  }

  const payload = readSafePayload(event.safeRawPayload);
  const mirrorProperties = readSafePayload(link.mirrorProperties);
  const scope = observationScope(event);
  if (
    !shouldApplyScopedObservation({
      mirrorProperties,
      scope,
      occurredAt: event.occurredAt,
      tieBreaker: event.dedupeKey,
    })
  ) {
    return "ignored";
  }
  const archiveState = getArchiveState(event.subscriptionType);
  if (archiveState === true) {
    await recordContactConflict(db, {
      portalId: event.hubspotPortalId,
      contactLinkId: link.id,
      channelContactId: link.channelContactId,
      hubspotObjectId: event.hubspotObjectId,
      propertyName: "__archived__",
      localValue: "false",
      hubspotValue: "true",
    });
  } else if (event.propertyName) {
    const localValue = getLocalContactProperty({
      propertyName: event.propertyName,
      ...link.channelContact,
    });
    await recordContactConflict(db, {
      portalId: event.hubspotPortalId,
      contactLinkId: link.id,
      channelContactId: link.channelContactId,
      hubspotObjectId: event.hubspotObjectId,
      propertyName: event.propertyName,
      localValue,
      hubspotValue: jsonScalar(payload.propertyValue),
    });
  }

  let nextMirrorProperties = setObservationCursor({
    mirrorProperties,
    scope,
    occurredAt: event.occurredAt,
    tieBreaker: event.dedupeKey,
  });
  if (event.propertyName) {
    nextMirrorProperties = {
      ...nextMirrorProperties,
      [event.propertyName]: jsonScalar(payload.propertyValue),
    };
  }

  await db.hubspotContactLink.update({
    where: { id: link.id },
    data: {
      lastObservedHubspotUpdatedAt: latestObservationAt(
        link.lastObservedHubspotUpdatedAt,
        event.occurredAt,
      ),
      ...(archiveState === undefined ? {} : { archived: archiveState }),
      mirrorProperties: toJsonValue(nextMirrorProperties),
    },
  });
  return "completed";
}

function getLocalDealProperty(input: {
  propertyName: string;
  name: string;
  dealName: string | null;
  pipeline: string | null;
  dealStage: string | null;
  currency: string | null;
  dealType: string | null;
}): string | null {
  switch (input.propertyName.trim().toLowerCase()) {
    case "dealname":
      return input.dealName ?? input.name;
    case "pipeline":
      return input.pipeline;
    case "dealstage":
      return input.dealStage;
    case "deal_currency_code":
      return input.currency;
    case "dealtype":
      return input.dealType;
    default:
      return null;
  }
}

async function recordDealConflict(db: DbTransactionClient, input: {
  portalId: string;
  dealLinkId: string;
  runRequestId: string;
  hubspotObjectId: string;
  propertyName: string;
  localValue: string | null;
  hubspotValue: string | null;
  ownership?: PrismaHubspotConflictOwnership;
}): Promise<void> {
  const ownership = input.ownership
    ?? ownershipToPrisma(classifyHubspotPropertyOwnership(input.propertyName));
  const normalizedLocal = input.localValue?.trim() || null;
  const normalizedHubspot = input.hubspotValue?.trim() || null;
  if (normalizedLocal === normalizedHubspot) {
    return;
  }
  const dedupeKey = `deal:${input.dealLinkId}:${input.propertyName.toLowerCase()}`;
  await db.hubspotConflict.upsert({
    where: {
      hubspotPortalId_dedupeKey: {
        hubspotPortalId: input.portalId,
        dedupeKey,
      },
    },
    create: {
      hubspotPortalId: input.portalId,
      dedupeKey,
      hubspotDealLinkId: input.dealLinkId,
      runRequestId: input.runRequestId,
      hubspotObjectType: "deals",
      hubspotObjectId: input.hubspotObjectId,
      propertyName: input.propertyName,
      localValue: toConflictJsonValue(normalizedLocal),
      hubspotValue: toConflictJsonValue(normalizedHubspot),
      ownership,
    },
    update: {
      localValue: toConflictJsonValue(normalizedLocal),
      hubspotValue: toConflictJsonValue(normalizedHubspot),
      ownership,
      status: PrismaHubspotConflictStatus.OPEN,
      detectedAt: new Date(),
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionAction: null,
      resolutionNote: null,
    },
  });
}

async function processDealEvent(db: DbTransactionClient, event: {
  hubspotPortalId: string;
  hubspotObjectId: string;
  subscriptionType: string;
  propertyName: string | null;
  occurredAt: Date;
  dedupeKey: string;
  safeRawPayload: Prisma.JsonValue | null;
}): Promise<"completed" | "ignored"> {
  const [link, dealMirror] = await Promise.all([
    db.hubspotDealLink.findUnique({
      where: {
        hubspotPortalId_hubspotObjectId: {
          hubspotPortalId: event.hubspotPortalId,
          hubspotObjectId: event.hubspotObjectId,
        },
      },
      select: {
        id: true,
        runRequestId: true,
        lastObservedHubspotUpdatedAt: true,
        mirrorProperties: true,
        runRequest: {
          select: {
            name: true,
            dealName: true,
            pipeline: true,
            dealStage: true,
            currency: true,
            dealType: true,
          },
        },
      },
    }),
    db.hubspotDealMirror.findUnique({
      where: {
        hubspotPortalId_hubspotObjectId: {
          hubspotPortalId: event.hubspotPortalId,
          hubspotObjectId: event.hubspotObjectId,
        },
      },
      select: {
        id: true,
        dealName: true,
        lastObservedHubspotUpdatedAt: true,
        mirrorProperties: true,
      },
    }),
  ]);
  if (!link && !dealMirror) {
    return "ignored";
  }

  const payload = readSafePayload(event.safeRawPayload);
  const scope = observationScope(event);
  const archiveState = getArchiveState(event.subscriptionType);
  let handled = false;

  if (link) {
    const mirrorProperties = readSafePayload(link.mirrorProperties);
    if (shouldApplyScopedObservation({
      mirrorProperties,
      scope,
      occurredAt: event.occurredAt,
      tieBreaker: event.dedupeKey,
    })) {
      if (archiveState === true) {
        await recordDealConflict(db, {
          portalId: event.hubspotPortalId,
          dealLinkId: link.id,
          runRequestId: link.runRequestId,
          hubspotObjectId: event.hubspotObjectId,
          propertyName: "__archived__",
          localValue: "false",
          hubspotValue: "true",
          ownership: PrismaHubspotConflictOwnership.HUBSPOT,
        });
      } else if (
        event.propertyName
        && classifyHubspotPropertyOwnership(event.propertyName) !== "hubspot"
      ) {
        await recordDealConflict(db, {
          portalId: event.hubspotPortalId,
          dealLinkId: link.id,
          runRequestId: link.runRequestId,
          hubspotObjectId: event.hubspotObjectId,
          propertyName: event.propertyName,
          localValue: getLocalDealProperty({
            propertyName: event.propertyName,
            ...link.runRequest,
          }),
          hubspotValue: jsonScalar(payload.propertyValue),
        });
      }

      let nextMirrorProperties = setObservationCursor({
        mirrorProperties,
        scope,
        occurredAt: event.occurredAt,
        tieBreaker: event.dedupeKey,
      });
      if (event.propertyName) {
        nextMirrorProperties = {
          ...nextMirrorProperties,
          [event.propertyName]: jsonScalar(payload.propertyValue),
        };
      }

      await db.hubspotDealLink.update({
        where: { id: link.id },
        data: {
          lastObservedHubspotUpdatedAt: latestObservationAt(
            link.lastObservedHubspotUpdatedAt,
            event.occurredAt,
          ),
          ...(archiveState === undefined ? {} : { archived: archiveState }),
          mirrorProperties: toJsonValue(nextMirrorProperties),
        },
      });
      handled = true;
    }
  }

  if (dealMirror) {
    const mirrorProperties = readSafePayload(dealMirror.mirrorProperties);
    if (shouldApplyScopedObservation({
      mirrorProperties,
      scope,
      occurredAt: event.occurredAt,
      tieBreaker: event.dedupeKey,
    })) {
      const propertyValue = jsonScalar(payload.propertyValue);
      let nextMirrorProperties = setObservationCursor({
        mirrorProperties,
        scope,
        occurredAt: event.occurredAt,
        tieBreaker: event.dedupeKey,
      });
      if (event.propertyName) {
        nextMirrorProperties = {
          ...nextMirrorProperties,
          [event.propertyName]: propertyValue,
        };
      }
      const dateValue = propertyValue
        ? new Date(/^\d+$/.test(propertyValue) ? Number(propertyValue) : propertyValue)
        : null;
      const parsedDate = dateValue && !Number.isNaN(dateValue.getTime()) ? dateValue : null;
      const propertyData: Prisma.HubspotDealMirrorUpdateInput = {};
      switch (event.propertyName?.trim().toLowerCase()) {
        case "dealname":
          propertyData.dealName = propertyValue?.trim() || dealMirror.dealName;
          break;
        case "amount":
          propertyData.amount = propertyValue;
          break;
        case "deal_currency_code":
          propertyData.currencyCode = propertyValue;
          break;
        case "pipeline":
          propertyData.pipelineId = propertyValue;
          break;
        case "dealstage":
          propertyData.stageId = propertyValue;
          break;
        case "hubspot_owner_id":
          propertyData.ownerId = propertyValue;
          break;
        case "closedate":
          propertyData.closeDate = parsedDate;
          break;
        case "createdate":
          propertyData.hubspotCreatedAt = parsedDate;
          break;
      }

      await db.hubspotDealMirror.update({
        where: { id: dealMirror.id },
        data: {
          ...propertyData,
          lastObservedHubspotUpdatedAt: latestObservationAt(
            dealMirror.lastObservedHubspotUpdatedAt,
            event.occurredAt,
          ),
          ...(archiveState === undefined ? {} : { archived: archiveState }),
          mirrorProperties: toJsonValue(nextMirrorProperties),
        },
      });
      handled = true;
    }
  }

  return handled ? "completed" : "ignored";
}

async function lockWebhookObjects(
  db: DbTransactionClient,
  event: {
    hubspotPortalId: string;
    objectType: string;
    hubspotObjectId: string;
    subscriptionType: string;
    safeRawPayload: Prisma.JsonValue | null;
  },
): Promise<void> {
  const objectIds = new Set([event.hubspotObjectId]);
  if (
    event.objectType === "contact"
    && event.subscriptionType.toLowerCase().includes("merge")
  ) {
    const mergeIdentity = getContactMergeIdentity({
      eventObjectId: event.hubspotObjectId,
      payload: readSafePayload(event.safeRawPayload),
    });
    if (mergeIdentity) {
      objectIds.add(mergeIdentity.targetId);
      for (const losingId of mergeIdentity.losingIds) {
        objectIds.add(losingId);
      }
    }
  }

  // Locks are transaction-scoped. Sorting a merge's winner and losing IDs
  // keeps concurrent multi-object events from acquiring them in opposite
  // orders, while the hash keeps keys within PostgreSQL's bigint interface.
  for (const objectId of [...objectIds].sort()) {
    const lockKey = [
      "hubspot-webhook",
      event.hubspotPortalId,
      event.objectType,
      objectId,
    ].join(":");
    await db.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS acquired
    `;
  }
}

export async function processHubspotWebhookEvent(input: {
  webhookEventId: string;
}): Promise<void> {
  const claimStartedAt = new Date();
  const staleProcessingBefore = new Date(
    claimStartedAt.getTime() - WEBHOOK_PROCESSING_LEASE_MS,
  );
  const claimed = await prisma.hubspotWebhookEvent.updateMany({
    where: {
      id: input.webhookEventId,
      retryCount: { lt: WEBHOOK_MAX_RETRIES },
      OR: [
        {
          status: {
            in: [
              PrismaHubspotWebhookEventStatus.RECEIVED,
              PrismaHubspotWebhookEventStatus.QUEUED,
            ],
          },
        },
        {
          status: PrismaHubspotWebhookEventStatus.FAILED,
          AND: {
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: claimStartedAt } }],
          },
        },
        {
          status: PrismaHubspotWebhookEventStatus.RUNNING,
          startedAt: { lte: staleProcessingBefore },
        },
      ],
    },
    data: {
      status: PrismaHubspotWebhookEventStatus.RUNNING,
      startedAt: claimStartedAt,
      completedAt: null,
      nextRetryAt: null,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const event = await tx.hubspotWebhookEvent.findFirst({
        where: {
          id: input.webhookEventId,
          status: PrismaHubspotWebhookEventStatus.RUNNING,
          startedAt: claimStartedAt,
        },
        select: {
          id: true,
          hubspotPortalId: true,
          dedupeKey: true,
          subscriptionType: true,
          objectType: true,
          hubspotObjectId: true,
          propertyName: true,
          occurredAt: true,
          safeRawPayload: true,
        },
      });
      if (!event) {
        throw new HubspotWebhookLeaseLostError();
      }

      await lockWebhookObjects(tx, event);
      const outcome = event.objectType === "contact"
        ? await processContactEvent(tx, event)
        : event.objectType === "deal"
          ? await processDealEvent(tx, event)
          : "ignored";
      const completedAt = new Date();

      const completed = await tx.hubspotWebhookEvent.updateMany({
        where: {
          id: event.id,
          status: PrismaHubspotWebhookEventStatus.RUNNING,
          startedAt: claimStartedAt,
        },
        data: {
          status: outcome === "ignored"
            ? PrismaHubspotWebhookEventStatus.IGNORED
            : PrismaHubspotWebhookEventStatus.COMPLETED,
          completedAt,
          lastError: null,
        },
      });
      if (completed.count === 0) {
        // This must throw inside the transaction so every conflict/link write
        // made by the stale worker is rolled back with the lost completion.
        throw new HubspotWebhookLeaseLostError();
      }
      await tx.hubspotPortal.update({
        where: { id: event.hubspotPortalId },
        data: { lastWebhookProcessedAt: completedAt },
      });
    }, { timeout: WEBHOOK_TRANSACTION_TIMEOUT_MS });
  } catch (error) {
    if (error instanceof HubspotWebhookLeaseLostError) {
      return;
    }

    const current = await prisma.hubspotWebhookEvent.findFirst({
      where: {
        id: input.webhookEventId,
        status: PrismaHubspotWebhookEventStatus.RUNNING,
        startedAt: claimStartedAt,
      },
      select: { retryCount: true },
    });
    if (!current) {
      return;
    }

    const retryCount = current.retryCount + 1;
    const terminal = retryCount >= WEBHOOK_MAX_RETRIES;
    const delayMs = Math.min(
      WEBHOOK_RETRY_MAX_MS,
      WEBHOOK_RETRY_BASE_MS * 2 ** Math.min(retryCount - 1, 6),
    );
    const nextRetryAt = terminal ? null : new Date(Date.now() + delayMs);
    const failed = await prisma.hubspotWebhookEvent.updateMany({
      where: {
        id: input.webhookEventId,
        status: PrismaHubspotWebhookEventStatus.RUNNING,
        startedAt: claimStartedAt,
        retryCount: current.retryCount,
      },
      data: {
        status: PrismaHubspotWebhookEventStatus.FAILED,
        retryCount,
        nextRetryAt,
        completedAt: new Date(),
        lastError: formatError(error),
      },
    });
    if (failed.count === 0) {
      return;
    }

    if (!terminal) {
      try {
        await enqueueHubspotWebhookJob(
          { webhookEventId: input.webhookEventId },
          {
            startAfterSeconds: Math.max(1, Math.ceil(delayMs / 1_000)),
            // The current delivery already owns the ingress singleton. A
            // delayed recovery job must not be suppressed by that window.
            deduplicate: false,
          },
        );
      } catch (enqueueError) {
        // Let pg-boss retry the current job immediately if scheduling the
        // durable delayed retry failed; a future nextRetryAt without a job
        // would otherwise strand the event.
        const resetForWorkerRetry = await prisma.hubspotWebhookEvent.updateMany({
          where: {
            id: input.webhookEventId,
            status: PrismaHubspotWebhookEventStatus.FAILED,
            startedAt: claimStartedAt,
            retryCount,
            nextRetryAt,
          },
          data: {
            nextRetryAt: null,
            lastError: `${formatError(error)}; retry enqueue failed: ${formatError(enqueueError)}`
              .slice(0, 2_000),
          },
        });
        if (resetForWorkerRetry.count === 0) {
          return;
        }
        throw enqueueError;
      }
    }
    throw error;
  }
}
