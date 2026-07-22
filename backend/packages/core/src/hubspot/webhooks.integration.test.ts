import {
  HubspotConflictOwnership,
  HubspotWebhookEventStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

const { enqueueMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
}));

vi.mock("./queue", () => ({
  enqueueHubspotWebhookJob: enqueueMock,
}));

type WebhooksModule = typeof import("./webhooks");

integration("HubSpot webhook reconciliation", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });
    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    vi.clearAllMocks();
    enqueueMock.mockResolvedValue(undefined);
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_portals,
        channels
      RESTART IDENTITY CASCADE
    `);
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterAll(async () => {
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  async function loadWebhooks(): Promise<WebhooksModule> {
    return import("./webhooks");
  }

  async function seedContactLink(input?: {
    archived?: boolean;
    hubspotObjectId?: string;
    hubspotPortalId?: string;
    linkId?: string;
  }): Promise<{
    portalId: string;
    linkId: string;
    channelContactId: string;
  }> {
    const portal = input?.hubspotPortalId
      ? { id: input.hubspotPortalId }
      : await prisma.hubspotPortal.create({
          data: { portalId: "12345" },
          select: { id: true },
        });
    const hubspotObjectId = input?.hubspotObjectId ?? "contact-100";
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: `UC-webhook-${hubspotObjectId}`,
        title: "Webhook Test Creator",
      },
    });
    const contact = await prisma.channelContact.create({
      data: {
        channelId: channel.id,
        email: `${hubspotObjectId}@example.com`,
        firstName: "Local First",
        lastName: "Local Last",
      },
    });
    const link = await prisma.hubspotContactLink.create({
      data: {
        ...(input?.linkId ? { id: input.linkId } : {}),
        hubspotPortalId: portal.id,
        channelContactId: contact.id,
        hubspotObjectId,
        externalKey: `contact:${contact.id}`,
        archived: input?.archived ?? false,
      },
    });
    return {
      portalId: portal.id,
      linkId: link.id,
      channelContactId: contact.id,
    };
  }

  async function createEvent(input: {
    portalId: string;
    dedupeKey: string;
    subscriptionType?: string;
    propertyName?: string;
    propertyValue?: string;
    hubspotObjectId?: string;
    safeRawPayload?: Prisma.InputJsonObject;
    objectType?: "contact" | "deal";
    occurredAt: Date;
  }): Promise<string> {
    const event = await prisma.hubspotWebhookEvent.create({
      data: {
        hubspotPortalId: input.portalId,
        dedupeKey: input.dedupeKey,
        subscriptionType: input.subscriptionType ?? "contact.propertyChange",
        eventType: input.subscriptionType ?? "contact.propertyChange",
        objectType: input.objectType ?? "contact",
        hubspotObjectId: input.hubspotObjectId ?? "contact-100",
        propertyName: input.propertyName ?? null,
        occurredAt: input.occurredAt,
        status: HubspotWebhookEventStatus.QUEUED,
        safeRawPayload: {
          ...(input.propertyName ? { propertyName: input.propertyName } : {}),
          ...(input.propertyValue ? { propertyValue: input.propertyValue } : {}),
          occurredAt: input.occurredAt.toISOString(),
          ...input.safeRawPayload,
        },
      },
      select: { id: true },
    });
    return event.id;
  }

  it("deduplicates redelivery and recovers an event left received by an enqueue failure", async () => {
    const delivery = [{
      eventId: 42,
      subscriptionId: 7,
      portalId: 12345,
      occurredAt: Date.parse("2026-07-20T12:00:00.000Z"),
      subscriptionType: "contact.propertyChange",
      objectId: 100,
      propertyName: "firstname",
      propertyValue: "HubSpot First",
    }];
    const webhooks = await loadWebhooks();
    enqueueMock.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      webhooks.acceptHubspotWebhookDelivery({
        expectedPortalId: "12345",
        events: delivery,
      }),
    ).rejects.toThrow("queue unavailable");

    const strandedEvent = await prisma.hubspotWebhookEvent.findFirstOrThrow();
    expect(strandedEvent.status).toBe(HubspotWebhookEventStatus.RECEIVED);

    const retried = await webhooks.acceptHubspotWebhookDelivery({
      expectedPortalId: "12345",
      events: delivery,
    });

    expect(retried).toEqual({ accepted: 0, duplicates: 1 });
    expect(await prisma.hubspotWebhookEvent.count()).toBe(1);
    expect(
      await prisma.hubspotWebhookEvent.findUniqueOrThrow({
        where: { id: strandedEvent.id },
        select: { status: true },
      }),
    ).toEqual({ status: HubspotWebhookEventStatus.QUEUED });
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("persists distinct deliveries when HubSpot reuses an event ID", async () => {
    const baseDelivery = {
      eventId: 42,
      subscriptionId: 7,
      portalId: 12345,
      occurredAt: Date.parse("2026-07-20T12:00:00.000Z"),
      subscriptionType: "contact.propertyChange",
      objectId: 100,
      propertyName: "firstname",
      propertyValue: "HubSpot First",
    };
    const delivery = [
      baseDelivery,
      { ...baseDelivery, propertyName: "lastname", propertyValue: "HubSpot Last" },
      { ...baseDelivery, objectId: 101 },
      { ...baseDelivery, occurredAt: baseDelivery.occurredAt + 1 },
    ];
    const webhooks = await loadWebhooks();

    const firstAcceptance = await webhooks.acceptHubspotWebhookDelivery({
      expectedPortalId: "12345",
      events: delivery,
    });
    const exactRedelivery = await webhooks.acceptHubspotWebhookDelivery({
      expectedPortalId: "12345",
      events: delivery.map((event) => ({ ...event, attemptNumber: 1 })),
    });

    expect(firstAcceptance).toEqual({ accepted: 4, duplicates: 0 });
    expect(exactRedelivery).toEqual({ accepted: 0, duplicates: 4 });
    expect(await prisma.hubspotWebhookEvent.count()).toBe(4);
    expect(enqueueMock).toHaveBeenCalledTimes(4);
  });

  it("maps current generic contact and deal deliveries from their object type IDs", async () => {
    const webhooks = await loadWebhooks();

    const accepted = await webhooks.acceptHubspotWebhookDelivery({
      expectedPortalId: "12345",
      events: [
        {
          eventId: "generic-contact-1",
          subscriptionId: "subscription-contact",
          portalId: "12345",
          occurredAt: Date.parse("2026-07-20T12:00:00.000Z"),
          subscriptionType: "object.propertyChange",
          objectTypeId: "0-1",
          objectId: "contact-100",
          propertyName: "email",
          propertyValue: "creator@example.com",
        },
        {
          eventId: "generic-deal-1",
          subscriptionId: "subscription-deal",
          portalId: "12345",
          occurredAt: Date.parse("2026-07-20T12:01:00.000Z"),
          subscriptionType: "object.deletion",
          objectTypeId: "0-3",
          objectId: "deal-200",
        },
      ],
    });

    const persisted = await prisma.hubspotWebhookEvent.findMany({
      orderBy: { hubspotObjectId: "asc" },
      select: {
        objectType: true,
        hubspotObjectId: true,
        subscriptionType: true,
        safeRawPayload: true,
      },
    });
    expect(accepted).toEqual({ accepted: 2, duplicates: 0 });
    expect(persisted).toEqual([
      expect.objectContaining({
        objectType: "contact",
        hubspotObjectId: "contact-100",
        subscriptionType: "object.propertyChange",
        safeRawPayload: expect.objectContaining({ objectTypeId: "0-1" }),
      }),
      expect.objectContaining({
        objectType: "deal",
        hubspotObjectId: "deal-200",
        subscriptionType: "object.deletion",
        safeRawPayload: expect.objectContaining({ objectTypeId: "0-3" }),
      }),
    ]);
    expect(enqueueMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a generic delivery for an unsupported object type", async () => {
    const webhooks = await loadWebhooks();

    await expect(
      webhooks.acceptHubspotWebhookDelivery({
        expectedPortalId: "12345",
        events: [
          {
            eventId: "generic-company-1",
            subscriptionId: "subscription-company",
            portalId: "12345",
            occurredAt: Date.parse("2026-07-20T12:00:00.000Z"),
            subscriptionType: "object.propertyChange",
            objectTypeId: "0-2",
            objectId: "company-100",
            propertyName: "name",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_WEBHOOK_OBJECT_TYPE_UNSUPPORTED",
      status: 400,
    });
    expect(await prisma.hubspotWebhookEvent.count()).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("accepts an older observation for property B after a newer property A event", async () => {
    const { portalId, linkId } = await seedContactLink();
    const newerFirstNameEventId = await createEvent({
      portalId,
      dedupeKey: "event:newer-firstname",
      propertyName: "firstname",
      propertyValue: "HubSpot First",
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    const olderLastNameEventId = await createEvent({
      portalId,
      dedupeKey: "event:older-lastname",
      propertyName: "lastname",
      propertyValue: "HubSpot Last",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });
    const webhooks = await loadWebhooks();

    await webhooks.processHubspotWebhookEvent({ webhookEventId: newerFirstNameEventId });
    await webhooks.processHubspotWebhookEvent({ webhookEventId: olderLastNameEventId });

    const [link, events] = await Promise.all([
      prisma.hubspotContactLink.findUniqueOrThrow({ where: { id: linkId } }),
      prisma.hubspotWebhookEvent.findMany({
        where: { id: { in: [newerFirstNameEventId, olderLastNameEventId] } },
        select: { id: true, status: true },
      }),
    ]);
    expect(link.lastObservedHubspotUpdatedAt).toEqual(
      new Date("2026-07-20T12:00:00.000Z"),
    );
    expect(link.mirrorProperties).toMatchObject({
      firstname: "HubSpot First",
      lastname: "HubSpot Last",
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: newerFirstNameEventId,
          status: HubspotWebhookEventStatus.COMPLETED,
        }),
        expect.objectContaining({
          id: olderLastNameEventId,
          status: HubspotWebhookEventStatus.COMPLETED,
        }),
      ]),
    );
  });

  it("serializes concurrent events for one object and preserves the newest property value", async () => {
    const { portalId, linkId } = await seedContactLink();
    const olderEventId = await createEvent({
      portalId,
      dedupeKey: "event:older-firstname",
      propertyName: "firstname",
      propertyValue: "Older HubSpot First",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });
    const newerEventId = await createEvent({
      portalId,
      dedupeKey: "event:newer-firstname",
      propertyName: "firstname",
      propertyValue: "Newest HubSpot First",
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    const webhooks = await loadWebhooks();

    await Promise.all([
      webhooks.processHubspotWebhookEvent({ webhookEventId: olderEventId }),
      webhooks.processHubspotWebhookEvent({ webhookEventId: newerEventId }),
    ]);

    const [link, conflict, olderEvent, newerEvent] = await Promise.all([
      prisma.hubspotContactLink.findUniqueOrThrow({ where: { id: linkId } }),
      prisma.hubspotConflict.findFirstOrThrow({
        where: { hubspotContactLinkId: linkId, propertyName: "firstname" },
      }),
      prisma.hubspotWebhookEvent.findUniqueOrThrow({ where: { id: olderEventId } }),
      prisma.hubspotWebhookEvent.findUniqueOrThrow({ where: { id: newerEventId } }),
    ]);
    expect(link.mirrorProperties).toMatchObject({
      firstname: "Newest HubSpot First",
    });
    expect(link.lastObservedHubspotUpdatedAt).toEqual(
      new Date("2026-07-20T12:00:00.000Z"),
    );
    expect(conflict.hubspotValue).toBe("Newest HubSpot First");
    expect(olderEvent.status).toEqual(
      expect.stringMatching(/completed|ignored/i),
    );
    expect(newerEvent.status).toBe(HubspotWebhookEventStatus.COMPLETED);
  });

  it("rolls back a stale worker after a successor replaces its startedAt token", async () => {
    const { portalId, linkId } = await seedContactLink();
    const webhookEventId = await createEvent({
      portalId,
      dedupeKey: "event:stale-worker-fencing",
      propertyName: "firstname",
      propertyValue: "Stale HubSpot First",
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    const webhooks = await loadWebhooks();
    const lockKey = [
      "hubspot-webhook",
      portalId,
      "contact",
      "contact-100",
    ].join(":");
    let objectLockHolderPid: number | null = null;
    let releaseObjectLock = () => {};
    let signalObjectLockReady = () => {};
    const objectLockReady = new Promise<void>((resolve) => {
      signalObjectLockReady = resolve;
    });
    const releaseObjectLockPromise = new Promise<void>((resolve) => {
      releaseObjectLock = resolve;
    });
    const objectLockHolder = prisma.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT
          pg_backend_pid()::int AS pid,
          pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS acquired
      `;
      objectLockHolderPid = lock?.pid ?? null;
      signalObjectLockReady();
      await releaseObjectLockPromise;
    }, { timeout: 20_000 });

    await objectLockReady;
    const processing = webhooks.processHubspotWebhookEvent({ webhookEventId });

    try {
      const waitDeadline = Date.now() + 5_000;
      let waitingForObjectLock = false;
      while (Date.now() < waitDeadline) {
        const [lockState] = await prisma.$queryRaw<Array<{ waiting: number }>>`
          SELECT COUNT(DISTINCT waiting.pid)::int AS waiting
          FROM pg_locks AS held
          INNER JOIN pg_locks AS waiting
            ON waiting.locktype = held.locktype
            AND waiting.database IS NOT DISTINCT FROM held.database
            AND waiting.classid IS NOT DISTINCT FROM held.classid
            AND waiting.objid IS NOT DISTINCT FROM held.objid
            AND waiting.objsubid IS NOT DISTINCT FROM held.objsubid
          WHERE held.pid = ${objectLockHolderPid}
            AND held.locktype = 'advisory'
            AND held.granted
            AND NOT waiting.granted
        `;
        if ((lockState?.waiting ?? 0) > 0) {
          waitingForObjectLock = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waitingForObjectLock).toBe(true);

      const claimedEvent = await prisma.hubspotWebhookEvent.findUniqueOrThrow({
        where: { id: webhookEventId },
        select: { status: true, startedAt: true },
      });
      expect(claimedEvent.status).toBe(HubspotWebhookEventStatus.RUNNING);
      expect(claimedEvent.startedAt).not.toBeNull();
      const successorStartedAt = new Date(
        claimedEvent.startedAt!.getTime() + 1_000,
      );
      const takeover = await prisma.hubspotWebhookEvent.updateMany({
        where: {
          id: webhookEventId,
          status: HubspotWebhookEventStatus.RUNNING,
          startedAt: claimedEvent.startedAt,
        },
        data: { startedAt: successorStartedAt },
      });
      expect(takeover.count).toBe(1);

      releaseObjectLock();
      await Promise.all([objectLockHolder, processing]);

      const [event, link, portal, conflictCount] = await Promise.all([
        prisma.hubspotWebhookEvent.findUniqueOrThrow({
          where: { id: webhookEventId },
        }),
        prisma.hubspotContactLink.findUniqueOrThrow({ where: { id: linkId } }),
        prisma.hubspotPortal.findUniqueOrThrow({ where: { id: portalId } }),
        prisma.hubspotConflict.count({ where: { hubspotContactLinkId: linkId } }),
      ]);
      expect(event).toMatchObject({
        status: HubspotWebhookEventStatus.RUNNING,
        startedAt: successorStartedAt,
        completedAt: null,
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
      });
      expect(link.lastObservedHubspotUpdatedAt).toBeNull();
      expect(link.mirrorProperties).toBeNull();
      expect(portal.lastWebhookProcessedAt).toBeNull();
      expect(conflictCount).toBe(0);
      expect(enqueueMock).not.toHaveBeenCalled();
    } finally {
      releaseObjectLock();
      await Promise.allSettled([objectLockHolder, processing]);
    }
  });

  it("does not unarchive a link when an ordinary property event arrives", async () => {
    const { portalId, linkId } = await seedContactLink({ archived: true });
    const propertyEventId = await createEvent({
      portalId,
      dedupeKey: "event:property-after-archive",
      propertyName: "firstname",
      propertyValue: "HubSpot First",
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    const webhooks = await loadWebhooks();

    await webhooks.processHubspotWebhookEvent({ webhookEventId: propertyEventId });

    const link = await prisma.hubspotContactLink.findUniqueOrThrow({
      where: { id: linkId },
    });
    expect(link.archived).toBe(true);
  });

  it("does not reapply an older archive after a newer restore event", async () => {
    const { portalId, linkId } = await seedContactLink({ archived: true });
    const restoreEventId = await createEvent({
      portalId,
      dedupeKey: "event:newer-restore",
      subscriptionType: "contact.restore",
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    });
    const archiveEventId = await createEvent({
      portalId,
      dedupeKey: "event:older-archive",
      subscriptionType: "contact.deletion",
      occurredAt: new Date("2026-07-20T11:00:00.000Z"),
    });
    const webhooks = await loadWebhooks();

    await webhooks.processHubspotWebhookEvent({ webhookEventId: restoreEventId });
    await webhooks.processHubspotWebhookEvent({ webhookEventId: archiveEventId });

    const [link, archiveEvent] = await Promise.all([
      prisma.hubspotContactLink.findUniqueOrThrow({ where: { id: linkId } }),
      prisma.hubspotWebhookEvent.findUniqueOrThrow({ where: { id: archiveEventId } }),
    ]);
    expect(link.archived).toBe(false);
    expect(archiveEvent.status).toBe(HubspotWebhookEventStatus.IGNORED);
  });

  it("promotes the stable lowest-ID losing contact link on a merge", async () => {
    const first = await seedContactLink({
      hubspotObjectId: "contact-200",
      linkId: "00000000-0000-4000-8000-000000000001",
    });
    const second = await seedContactLink({
      hubspotPortalId: first.portalId,
      hubspotObjectId: "contact-201",
      linkId: "00000000-0000-4000-8000-000000000002",
    });
    const occurredAt = new Date("2026-07-20T12:00:00.000Z");
    const mergeEventId = await createEvent({
      portalId: first.portalId,
      dedupeKey: "event:merge-without-winner-link",
      subscriptionType: "contact.merge",
      hubspotObjectId: "contact-999",
      occurredAt,
      safeRawPayload: {
        objectId: "contact-999",
        newObjectId: "contact-999",
        mergedObjectIds: ["contact-201", "contact-200"],
        occurredAt: occurredAt.toISOString(),
      },
    });
    const webhooks = await loadWebhooks();

    await webhooks.processHubspotWebhookEvent({ webhookEventId: mergeEventId });

    const [promoted, tombstone, mergeConflict, event] = await Promise.all([
      prisma.hubspotContactLink.findUniqueOrThrow({ where: { id: first.linkId } }),
      prisma.hubspotContactLink.findUniqueOrThrow({ where: { id: second.linkId } }),
      prisma.hubspotConflict.findFirstOrThrow({
        where: {
          hubspotContactLinkId: second.linkId,
          propertyName: "__merge__",
        },
      }),
      prisma.hubspotWebhookEvent.findUniqueOrThrow({ where: { id: mergeEventId } }),
    ]);
    expect(promoted).toMatchObject({
      hubspotObjectId: "contact-999",
      archived: false,
    });
    expect(tombstone).toMatchObject({
      hubspotObjectId: "contact-201",
      archived: true,
      mirrorProperties: expect.objectContaining({
        mergedIntoHubspotObjectId: "contact-999",
        mergedAt: occurredAt.toISOString(),
      }),
    });
    expect(mergeConflict).toMatchObject({
      channelContactId: second.channelContactId,
      hubspotObjectId: "contact-999",
      localValue: "contact-201",
      hubspotValue: "contact-999",
    });
    expect(event.status).toBe(HubspotWebhookEventStatus.COMPLETED);
  });

  it("keeps an existing merge winner and archives every losing-link collision", async () => {
    const winner = await seedContactLink({ hubspotObjectId: "contact-999" });
    const losingA = await seedContactLink({
      hubspotPortalId: winner.portalId,
      hubspotObjectId: "contact-200",
    });
    const losingB = await seedContactLink({
      hubspotPortalId: winner.portalId,
      hubspotObjectId: "contact-201",
    });
    await prisma.hubspotConflict.create({
      data: {
        hubspotPortalId: winner.portalId,
        dedupeKey: `contact:${losingA.linkId}:firstname`,
        channelContactId: losingA.channelContactId,
        hubspotContactLinkId: losingA.linkId,
        hubspotObjectType: "contacts",
        hubspotObjectId: "contact-200",
        propertyName: "firstname",
        localValue: "Local First",
        hubspotValue: "Remote First",
        ownership: HubspotConflictOwnership.SHARED,
      },
    });
    const occurredAt = new Date("2026-07-20T12:00:00.000Z");
    const mergeEventId = await createEvent({
      portalId: winner.portalId,
      dedupeKey: "event:merge-with-existing-winner",
      subscriptionType: "contact.merge",
      hubspotObjectId: "contact-999",
      occurredAt,
      safeRawPayload: {
        primaryObjectId: "contact-999",
        newObjectId: "contact-999",
        mergedObjectIds: ["contact-200", "contact-201"],
        occurredAt: occurredAt.toISOString(),
      },
    });
    const webhooks = await loadWebhooks();

    await webhooks.processHubspotWebhookEvent({ webhookEventId: mergeEventId });

    const [winnerAfter, losingLinks, conflicts] = await Promise.all([
      prisma.hubspotContactLink.findUniqueOrThrow({ where: { id: winner.linkId } }),
      prisma.hubspotContactLink.findMany({
        where: { id: { in: [losingA.linkId, losingB.linkId] } },
        orderBy: { id: "asc" },
      }),
      prisma.hubspotConflict.findMany({
        where: {
          hubspotContactLinkId: { in: [losingA.linkId, losingB.linkId] },
        },
      }),
    ]);
    expect(winnerAfter).toMatchObject({
      hubspotObjectId: "contact-999",
      archived: false,
    });
    expect(losingLinks).toHaveLength(2);
    expect(losingLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hubspotObjectId: "contact-200",
          archived: true,
          mirrorProperties: expect.objectContaining({
            mergedIntoHubspotObjectId: "contact-999",
          }),
        }),
        expect.objectContaining({
          hubspotObjectId: "contact-201",
          archived: true,
          mirrorProperties: expect.objectContaining({
            mergedIntoHubspotObjectId: "contact-999",
          }),
        }),
      ]),
    );
    expect(conflicts).toHaveLength(3);
    expect(conflicts.every((conflict) => conflict.hubspotObjectId === "contact-999"))
      .toBe(true);
  });

  it("stores a cleared shared property as JSON null rather than database null", async () => {
    const { portalId, linkId } = await seedContactLink();
    const occurredAt = new Date("2026-07-20T12:00:00.000Z");
    const propertyEventId = await createEvent({
      portalId,
      dedupeKey: "event:cleared-firstname",
      propertyName: "firstname",
      occurredAt,
      safeRawPayload: {
        propertyName: "firstname",
        propertyValue: null,
        occurredAt: occurredAt.toISOString(),
      },
    });
    const webhooks = await loadWebhooks();

    await webhooks.processHubspotWebhookEvent({ webhookEventId: propertyEventId });

    const conflict = await prisma.hubspotConflict.findFirstOrThrow({
      where: { hubspotContactLinkId: linkId, propertyName: "firstname" },
    });
    const [stored] = await prisma.$queryRaw<Array<{
      isDatabaseNull: boolean;
      jsonText: string | null;
    }>>`
      SELECT
        hubspot_value IS NULL AS "isDatabaseNull",
        hubspot_value::text AS "jsonText"
      FROM hubspot_conflicts
      WHERE id = ${conflict.id}::uuid
    `;
    expect(conflict.hubspotValue).toBeNull();
    expect(stored).toEqual({ isDatabaseNull: false, jsonText: "null" });
  });

  it("updates a mirrored collaboration deal without requiring a run-created deal link", async () => {
    const portal = await prisma.hubspotPortal.create({ data: { portalId: "12345" } });
    const mirror = await prisma.hubspotDealMirror.create({
      data: {
        hubspotPortalId: portal.id,
        hubspotObjectId: "deal-standalone",
        dealName: "HubSpot-created deal",
        amount: "100",
      },
    });
    const occurredAt = new Date("2026-07-20T12:00:00.000Z");
    const eventId = await createEvent({
      portalId: portal.id,
      dedupeKey: "event:deal-standalone-amount",
      subscriptionType: "deal.propertyChange",
      objectType: "deal",
      hubspotObjectId: "deal-standalone",
      propertyName: "amount",
      propertyValue: "250",
      occurredAt,
    });
    const webhooks = await loadWebhooks();

    await webhooks.processHubspotWebhookEvent({ webhookEventId: eventId });

    await expect(
      prisma.hubspotDealMirror.findUniqueOrThrow({ where: { id: mirror.id } }),
    ).resolves.toMatchObject({
      amount: "250",
      lastObservedHubspotUpdatedAt: occurredAt,
      mirrorProperties: expect.objectContaining({ amount: "250" }),
    });
    expect(await prisma.hubspotDealLink.count()).toBe(0);
  });
});
