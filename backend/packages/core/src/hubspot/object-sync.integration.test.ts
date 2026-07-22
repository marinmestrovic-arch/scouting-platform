import { PrismaClient, Role, RunMonth } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

const {
  fetchHubspotAssociationsMock,
  batchReadHubspotObjectsMock,
  fetchHubspotCustomObjectsMock,
  fetchHubspotAccountDetailsMock,
  fetchHubspotAccountIdentityMock,
  fetchHubspotAssociationLabelsMock,
  fetchHubspotOwnersMock,
  fetchHubspotPipelinesMock,
  fetchHubspotPropertyDefinitionMock,
  enqueueHubspotObjectSyncJobMock,
  searchHubspotObjectsUpdatedAfterMock,
} = vi.hoisted(() => ({
  fetchHubspotAssociationsMock: vi.fn(),
  batchReadHubspotObjectsMock: vi.fn(),
  fetchHubspotCustomObjectsMock: vi.fn(),
  fetchHubspotAccountDetailsMock: vi.fn(),
  fetchHubspotAccountIdentityMock: vi.fn(),
  fetchHubspotAssociationLabelsMock: vi.fn(),
  fetchHubspotOwnersMock: vi.fn(),
  fetchHubspotPipelinesMock: vi.fn(),
  fetchHubspotPropertyDefinitionMock: vi.fn(),
  enqueueHubspotObjectSyncJobMock: vi.fn(),
  searchHubspotObjectsUpdatedAfterMock: vi.fn(),
}));

vi.mock("@scouting-platform/integrations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@scouting-platform/integrations")>()),
  fetchHubspotAssociations: fetchHubspotAssociationsMock,
  batchReadHubspotObjects: batchReadHubspotObjectsMock,
  fetchHubspotCustomObjects: fetchHubspotCustomObjectsMock,
  fetchHubspotAccountDetails: fetchHubspotAccountDetailsMock,
  fetchHubspotAccountIdentity: fetchHubspotAccountIdentityMock,
  fetchHubspotAssociationLabels: fetchHubspotAssociationLabelsMock,
  fetchHubspotOwners: fetchHubspotOwnersMock,
  fetchHubspotPipelines: fetchHubspotPipelinesMock,
  fetchHubspotPropertyDefinition: fetchHubspotPropertyDefinitionMock,
  searchHubspotObjectsUpdatedAfter: searchHubspotObjectsUpdatedAfterMock,
}));

vi.mock("./queue", () => ({
  enqueueHubspotObjectSyncJob: enqueueHubspotObjectSyncJobMock,
}));

type ObjectSyncModule = typeof import("./object-sync");

integration("HubSpot object sync core service", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });
    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    setHubspotMappingEnv();
    process.env.HUBSPOT_API_KEY = "test-api-key";
    vi.clearAllMocks();
    enqueueHubspotObjectSyncJobMock.mockResolvedValue(undefined);
    fetchHubspotAccountDetailsMock.mockResolvedValue({
      companyCurrency: null,
      additionalCurrencies: [],
    });
    fetchHubspotAccountIdentityMock.mockResolvedValue({
      portalId: "12345",
      uiDomain: "app.hubspot.com",
      companyCurrency: null,
      additionalCurrencies: [],
    });
    fetchHubspotAssociationLabelsMock.mockResolvedValue([
      { category: "HUBSPOT_DEFINED", typeId: 1, label: null },
    ]);
    fetchHubspotOwnersMock.mockResolvedValue({ results: [], nextAfter: null });
    fetchHubspotPipelinesMock.mockResolvedValue([]);
    searchHubspotObjectsUpdatedAfterMock.mockResolvedValue({
      results: [],
      nextAfter: null,
    });
    fetchHubspotPropertyDefinitionMock.mockResolvedValue({
      name: "property",
      label: "Property",
      type: "enumeration",
      options: [],
    });
    batchReadHubspotObjectsMock.mockResolvedValue([]);
    fetchHubspotAssociationsMock.mockResolvedValue(new Map());

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_portals,
        hubspot_object_sync_runs,
        dropdown_values,
        campaigns,
        clients,
        markets,
        audit_events,
        users
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

  async function loadObjectSync(): Promise<ObjectSyncModule> {
    return import("./object-sync");
  }

  function setHubspotMappingEnv(): void {
    process.env.HUBSPOT_PORTAL_ID = "12345";
    process.env.HUBSPOT_CLIENT_OBJECT_TYPE = "2-CLIENT";
    process.env.HUBSPOT_CAMPAIGN_OBJECT_TYPE = "2-CAMPAIGN";
    process.env.HUBSPOT_ACTIVATION_OBJECT_TYPE = "2-ACTIVATION";
    process.env.HUBSPOT_CONTACT_WORKED_WITH_PROPERTY = "worked_with";
    process.env.HUBSPOT_ACTIVATION_NAME_PROPERTY = "activation_name";
    process.env.HUBSPOT_ACTIVATION_TYPE_PROPERTY = "activation_type";
    process.env.HUBSPOT_ACTIVATION_URL_PROPERTY = "activation_url";
    process.env.HUBSPOT_ACTIVATION_PUBLICATION_DATE_PROPERTY = "publication_date";
    process.env.HUBSPOT_CLIENT_NAME_PROPERTY = "client_name";
    process.env.HUBSPOT_CLIENT_DOMAIN_PROPERTY = "domain";
    process.env.HUBSPOT_CLIENT_COUNTRY_REGION_PROPERTY = "country";
    process.env.HUBSPOT_CLIENT_CITY_PROPERTY = "city";
    process.env.HUBSPOT_CLIENT_ACTIVE_PROPERTY = "active";
    process.env.HUBSPOT_CAMPAIGN_NAME_PROPERTY = "campaign_name";
    process.env.HUBSPOT_CAMPAIGN_CLIENT_OBJECT_ID_PROPERTY = "client_object_id";
    delete process.env.HUBSPOT_CAMPAIGN_CLIENT_ASSOCIATION_TYPE_ID;
    process.env.HUBSPOT_CAMPAIGN_MARKET_PROPERTY = "market";
    process.env.HUBSPOT_CAMPAIGN_BRIEF_LINK_PROPERTY = "brief";
    process.env.HUBSPOT_CAMPAIGN_MONTH_PROPERTY = "month";
    process.env.HUBSPOT_CAMPAIGN_YEAR_PROPERTY = "year";
    process.env.HUBSPOT_CAMPAIGN_STATUS_PROPERTY = "status";
    process.env.HUBSPOT_CAMPAIGN_ACTIVE_PROPERTY = "active";
  }

  async function createAdmin(email = "admin@example.com"): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email,
        name: "Admin",
        role: Role.ADMIN,
        passwordHash: "hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  async function createSyncRun(requestedByUserId: string): Promise<{ id: string }> {
    return prisma.hubspotObjectSyncRun.create({
      data: {
        requestedByUserId,
        objectTypes: ["clients", "campaigns", "dropdownValues"],
      },
      select: {
        id: true,
      },
    });
  }

  it("lists sync runs for admins", async () => {
    const objectSync = await loadObjectSync();
    const adminA = await createAdmin("admin-a@example.com");
    const adminB = await createAdmin("admin-b@example.com");
    const runA = await createSyncRun(adminA.id);
    const runB = await createSyncRun(adminB.id);

    const listed = await objectSync.listHubspotObjectSyncRuns({
      requestedByUserId: adminA.id,
    });

    expect(listed.items.map((item) => item.id)).toContain(runA.id);
    expect(listed.items.map((item) => item.id)).toContain(runB.id);
    expect(listed.latest?.id).toBe(runB.id);
  });

  it("re-enqueues an existing active sync run", async () => {
    const objectSync = await loadObjectSync();
    const originalAdmin = await createAdmin("original-admin@example.com");
    const retryingAdmin = await createAdmin("retrying-admin@example.com");
    const existing = await createSyncRun(originalAdmin.id);

    const result = await objectSync.createHubspotObjectSyncRun({
      requestedByUserId: retryingAdmin.id,
    });

    expect(result.id).toBe(existing.id);
    expect(result.status).toBe("queued");
    expect(enqueueHubspotObjectSyncJobMock).toHaveBeenCalledWith({
      syncRunId: existing.id,
      requestedByUserId: originalAdmin.id,
    });
  });

  it("persists and audits a new sync run when enqueueing fails", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    enqueueHubspotObjectSyncJobMock.mockRejectedValueOnce(new Error("queue unavailable"));

    await expect(
      objectSync.createHubspotObjectSyncRun({
        requestedByUserId: admin.id,
      }),
    ).rejects.toThrow("queue unavailable");

    const failedRun = await prisma.hubspotObjectSyncRun.findFirstOrThrow({
      where: { requestedByUserId: admin.id },
      orderBy: { createdAt: "desc" },
    });
    expect(failedRun.status).toBe("FAILED");
    expect(failedRun.completedAt).not.toBeNull();
    expect(failedRun.lastError).toContain("Failed to enqueue HubSpot object sync");
    expect(failedRun.lastError).toContain("queue unavailable");

    await expect(
      prisma.auditEvent.findFirstOrThrow({
        where: {
          action: "hubspot_object_sync.failed",
          entityId: failedRun.id,
        },
      }),
    ).resolves.toMatchObject({
      actorUserId: admin.id,
      entityType: "hubspot_object_sync_run",
    });
  });

  it("atomically rejects a run while the portal has an unexpired sync lease", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);
    const activeLeaseExpiresAt = new Date(Date.now() + 60_000);
    const portal = await prisma.hubspotPortal.create({
      data: {
        portalId: "12345",
        objectSyncLeaseOwner: "hubspot-object-sync:other-run",
        objectSyncLeaseExpiresAt: activeLeaseExpiresAt,
      },
    });

    await expect(
      objectSync.executeHubspotObjectSyncRun({
        syncRunId: run.id,
        requestedByUserId: admin.id,
      }),
    ).rejects.toMatchObject({ code: "HUBSPOT_OBJECT_SYNC_OVERLAP" });

    await expect(
      prisma.hubspotPortal.findUniqueOrThrow({ where: { id: portal.id } }),
    ).resolves.toMatchObject({
      objectSyncLeaseOwner: "hubspot-object-sync:other-run",
      objectSyncLeaseExpiresAt: activeLeaseExpiresAt,
    });
    await expect(
      prisma.hubspotObjectSyncRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({
      status: "FAILED",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    expect(fetchHubspotCustomObjectsMock).not.toHaveBeenCalled();
  });

  it("takes over an expired portal lease and releases it after completion", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);
    const portal = await prisma.hubspotPortal.create({
      data: {
        portalId: "12345",
        objectSyncLeaseOwner: "hubspot-object-sync:crashed-run",
        objectSyncLeaseExpiresAt: new Date(Date.now() - 60_000),
      },
    });
    fetchHubspotCustomObjectsMock.mockResolvedValue({ nextAfter: null, results: [] });

    const result = await objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });

    expect(result.status).toBe("completed");
    await expect(
      prisma.hubspotPortal.findUniqueOrThrow({ where: { id: portal.id } }),
    ).resolves.toMatchObject({
      objectSyncLeaseOwner: null,
      objectSyncLeaseExpiresAt: null,
    });
  });

  it("keeps active pipelines active when HubSpot repeats them in the archived query", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);
    fetchHubspotCustomObjectsMock.mockResolvedValue({ nextAfter: null, results: [] });
    fetchHubspotPipelinesMock.mockResolvedValue([
      {
        id: "default",
        label: "Sales Pipeline",
        archived: false,
        stages: [
          {
            id: "scouted",
            label: "Scouted",
            archived: false,
            metadata: {},
          },
        ],
      },
    ]);

    await objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });

    await expect(
      prisma.hubspotPipeline.findFirstOrThrow({
        where: { hubspotPipelineId: "default" },
        include: { stages: true },
      }),
    ).resolves.toMatchObject({
      archived: false,
      stages: [expect.objectContaining({ archived: false })],
    });
  });

  it("persists one HubSpot-created collaboration deal across multiple linked contacts", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);
    const portal = await prisma.hubspotPortal.create({ data: { portalId: "12345" } });
    const channel = await prisma.channel.create({
      data: { youtubeChannelId: "UC-collaboration-sync", title: "Collaboration Creator" },
    });
    const contacts = await Promise.all([
      prisma.channelContact.create({
        data: { channelId: channel.id, email: "creator-primary@example.com" },
      }),
      prisma.channelContact.create({
        data: { channelId: channel.id, email: "creator-secondary@example.com" },
      }),
    ]);
    await Promise.all(contacts.map((contact, index) => prisma.hubspotContactLink.create({
      data: {
        hubspotPortalId: portal.id,
        channelContactId: contact.id,
        hubspotObjectId: `contact-${index + 1}`,
        externalKey: `contact:${contact.id}`,
      },
    })));
    const client = await prisma.client.create({
      data: {
        name: "Collaboration Client",
        hubspotPortalId: portal.id,
        hubspotObjectType: "2-CLIENT",
        hubspotObjectId: "client-1",
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        name: "Collaboration Campaign",
        hubspotPortalId: portal.id,
        hubspotObjectType: "2-CAMPAIGN",
        hubspotObjectId: "campaign-1",
      },
    });
    fetchHubspotCustomObjectsMock.mockResolvedValue({ nextAfter: null, results: [] });
    batchReadHubspotObjectsMock.mockImplementation(async (input: { objectType: string }) => {
      if (input.objectType === "contacts") {
        return [
          { id: "contact-1", properties: { worked_with: "true" }, archived: false },
          { id: "contact-2", properties: { worked_with: "false" }, archived: false },
        ];
      }
      if (input.objectType === "deals") {
        return [{
          id: "deal-from-hubspot",
          properties: {
            dealname: "HubSpot-created collaboration",
            amount: "2500",
            deal_currency_code: "EUR",
            pipeline: "campaign-management",
            dealstage: "contract-signed",
            closedate: "2026-07-31T00:00:00.000Z",
            createdate: "2026-07-01T00:00:00.000Z",
          },
          archived: false,
        }];
      }
      return [{
        id: "activation-1",
        properties: {
          activation_name: "Creator video",
          activation_type: "YouTube",
          activation_url: "https://youtube.com/watch?v=collaboration",
          publication_date: "2026-07-20T00:00:00.000Z",
        },
        archived: false,
      }];
    });
    fetchHubspotAssociationsMock.mockImplementation(async (input: {
      fromObjectType: string;
      toObjectType: string;
    }) => {
      if (input.fromObjectType === "contacts") {
        return new Map([
          ["contact-1", ["deal-from-hubspot"]],
          ["contact-2", ["deal-from-hubspot"]],
        ]);
      }
      if (input.toObjectType === "2-CLIENT") {
        return new Map([["deal-from-hubspot", ["client-1"]]]);
      }
      if (input.toObjectType === "2-CAMPAIGN") {
        return new Map([["deal-from-hubspot", ["campaign-1"]]]);
      }
      return new Map([["deal-from-hubspot", ["activation-1"]]]);
    });

    const result = await objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });

    expect(result).toMatchObject({
      status: "completed",
      dealMirrorUpsertCount: 1,
      activationMirrorUpsertCount: 1,
    });
    await expect(prisma.hubspotDealMirror.count({
      where: { hubspotObjectId: "deal-from-hubspot" },
    })).resolves.toBe(1);
    await expect(prisma.hubspotContactDealAssociation.count({
      where: { hubspotDealMirror: { hubspotObjectId: "deal-from-hubspot" } },
    })).resolves.toBe(2);
    await expect(prisma.hubspotDealClientAssociation.findFirstOrThrow({
      where: { clientId: client.id },
    })).resolves.toMatchObject({ clientId: client.id });
    await expect(prisma.hubspotDealCampaignAssociation.findFirstOrThrow({
      where: { campaignId: campaign.id },
    })).resolves.toMatchObject({ campaignId: campaign.id });
    const links = await prisma.hubspotContactLink.findMany({
      where: { channelContact: { channelId: channel.id } },
      orderBy: { hubspotObjectId: "asc" },
    });
    expect(links.map((link) => link.mirrorProperties)).toEqual([
      expect.objectContaining({ worked_with: "true" }),
      expect.objectContaining({ worked_with: "false" }),
    ]);
  });

  it("prevents a stale snapshot from mutating domain data or clearing successor leases", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);
    const portal = await prisma.hubspotPortal.create({
      data: {
        portalId: "12345",
      },
    });
    type ClientPage = {
      nextAfter: null;
      results: Array<{
        id: string;
        archived: boolean;
        properties: Record<string, string>;
      }>;
    };
    const emptyPage: ClientPage = { nextAfter: null, results: [] };
    const stalePage: ClientPage = {
      nextAfter: null,
      results: [
        {
          id: "stale-client",
          archived: false,
          properties: {
            client_name: "Stale Snapshot Client",
            active: "true",
          },
        },
      ],
    };
    const successorPage: ClientPage = {
      nextAfter: null,
      results: [
        {
          id: "successor-client",
          archived: false,
          properties: {
            client_name: "Successor Snapshot Client",
            active: "true",
          },
        },
      ],
    };
    let resolveFirstPage!: (page: ClientPage) => void;
    let resolveSecondPage!: (page: ClientPage) => void;
    let signalFirstStarted!: () => void;
    let signalSecondStarted!: () => void;
    const firstPage = new Promise<ClientPage>((resolve) => {
      resolveFirstPage = resolve;
    });
    const secondPage = new Promise<ClientPage>((resolve) => {
      resolveSecondPage = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      signalSecondStarted = resolve;
    });
    let customObjectCallCount = 0;

    fetchHubspotCustomObjectsMock.mockImplementation(() => {
      customObjectCallCount += 1;

      if (customObjectCallCount === 1) {
        signalFirstStarted();
        return firstPage;
      }

      if (customObjectCallCount === 2) {
        signalSecondStarted();
        return secondPage;
      }

      return Promise.resolve(emptyPage);
    });

    const firstExecution = objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });
    await firstStarted;

    const firstLease = await prisma.hubspotObjectSyncRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { leaseOwner: true },
    });
    expect(firstLease.leaseOwner).toMatch(`hubspot-object-sync:${run.id}:`);

    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.$transaction([
      prisma.hubspotObjectSyncRun.update({
        where: { id: run.id },
        data: { leaseExpiresAt: expiredAt },
      }),
      prisma.hubspotPortal.update({
        where: { id: portal.id },
        data: { objectSyncLeaseExpiresAt: expiredAt },
      }),
    ]);

    const secondExecution = objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });
    await secondStarted;

    const successorRun = await prisma.hubspotObjectSyncRun.findUniqueOrThrow({
      where: { id: run.id },
      select: { leaseOwner: true, status: true },
    });
    expect(successorRun.status).toBe("RUNNING");
    expect(successorRun.leaseOwner).not.toBe(firstLease.leaseOwner);
    expect(successorRun.leaseOwner).toMatch(`hubspot-object-sync:${run.id}:`);

    resolveFirstPage(stalePage);
    await expect(firstExecution).rejects.toMatchObject({
      code: "HUBSPOT_OBJECT_SYNC_LEASE_LOST",
    });

    await expect(
      prisma.client.findFirst({ where: { hubspotObjectId: "stale-client" } }),
    ).resolves.toBeNull();

    await expect(
      prisma.hubspotObjectSyncRun.findUniqueOrThrow({ where: { id: run.id } }),
    ).resolves.toMatchObject({
      status: "RUNNING",
      leaseOwner: successorRun.leaseOwner,
      completedAt: null,
      lastError: null,
    });
    await expect(
      prisma.hubspotPortal.findUniqueOrThrow({ where: { id: portal.id } }),
    ).resolves.toMatchObject({
      objectSyncLeaseOwner: successorRun.leaseOwner,
    });
    const successorCursors = await prisma.hubspotSyncCursor.findMany({
      where: { hubspotPortalId: portal.id },
      select: { leaseOwner: true },
    });
    expect(successorCursors).toHaveLength(2);
    expect(successorCursors.every((cursor) => cursor.leaseOwner === successorRun.leaseOwner)).toBe(
      true,
    );
    await expect(
      prisma.auditEvent.count({
        where: {
          action: "hubspot_object_sync.failed",
          entityId: run.id,
        },
      }),
    ).resolves.toBe(0);

    resolveSecondPage(successorPage);
    await expect(secondExecution).resolves.toMatchObject({
      id: run.id,
      status: "completed",
      completedAt: expect.any(String),
      lastError: null,
    });
    await expect(
      prisma.hubspotPortal.findUniqueOrThrow({ where: { id: portal.id } }),
    ).resolves.toMatchObject({
      objectSyncLeaseOwner: null,
      objectSyncLeaseExpiresAt: null,
    });
    await expect(
      prisma.client.findFirstOrThrow({ where: { hubspotObjectId: "successor-client" } }),
    ).resolves.toMatchObject({
      name: "Successor Snapshot Client",
      hubspotPortalId: portal.id,
    });
    await expect(
      prisma.client.findFirst({ where: { hubspotObjectId: "stale-client" } }),
    ).resolves.toBeNull();
  });

  it("upserts HubSpot clients and campaigns", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);

    fetchHubspotCustomObjectsMock.mockImplementation(async (input: { objectType: string; archived: boolean }) => {
      if (input.objectType === "2-CLIENT" && !input.archived) {
        return {
          nextAfter: null,
          results: [
            {
              id: "client-101",
              archived: false,
              properties: {
                client_name: "Client A",
                domain: "client.example",
                country: "Croatia",
                city: "Zagreb",
                active: "true",
              },
            },
          ],
        };
      }

      if (input.objectType === "2-CAMPAIGN" && !input.archived) {
        return {
          nextAfter: null,
          results: [
            {
              id: "campaign-201",
              archived: false,
              properties: {
                campaign_name: "Spring Launch",
                client_object_id: "client-101",
                market: "Croatia",
                brief: "https://example.com/brief",
                month: "April",
                year: "2026",
                status: "In progress",
                active: "true",
              },
            },
          ],
        };
      }

      return { nextAfter: null, results: [] };
    });

    const result = await objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });

    expect(result.status).toBe("completed");
    expect(result.clientUpsertCount).toBe(1);
    expect(result.campaignUpsertCount).toBe(1);

    const client = await prisma.client.findUnique({ where: { name: "Client A" } });
    expect(client?.hubspotObjectId).toBe("client-101");
    expect(client?.isActive).toBe(true);

    const campaign = await prisma.campaign.findFirst({ where: { name: "Spring Launch" } });
    expect(campaign?.hubspotObjectId).toBe("campaign-201");
    expect(campaign?.month).toBe(RunMonth.APRIL);
    expect(campaign?.status).toBe("In progress");
  });

  it("retains HubSpot-sourced records when a full response merely omits them", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const client = await prisma.client.create({
      data: {
        name: "Client A",
        isActive: true,
        hubspotObjectId: "client-101",
        hubspotObjectType: "2-CLIENT",
      },
    });
    const market = await prisma.market.create({ data: { name: "Croatia" } });
    const campaign = await prisma.campaign.create({
      data: {
        name: "Spring Launch",
        clientId: client.id,
        marketId: market.id,
        month: RunMonth.APRIL,
        year: 2026,
        isActive: true,
        hubspotObjectId: "campaign-201",
        hubspotObjectType: "2-CAMPAIGN",
      },
    });
    const run = await createSyncRun(admin.id);

    fetchHubspotCustomObjectsMock.mockImplementation(async () => {
      return { nextAfter: null, results: [] };
    });

    const result = await objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });

    expect(result.status).toBe("completed");
    expect(result.deactivatedCount).toBe(0);
    await expect(prisma.campaign.findUnique({ where: { id: campaign.id } })).resolves.toMatchObject({
      isActive: true,
    });
    await expect(prisma.client.findUnique({ where: { id: client.id } })).resolves.toMatchObject({
      isActive: true,
    });
  });

  it("tombstones only records explicitly returned as archived", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const client = await prisma.client.create({
      data: {
        name: "Archived Client",
        isActive: true,
        hubspotObjectId: "client-archived",
        hubspotObjectType: "2-CLIENT",
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        name: "Archived Campaign",
        clientId: client.id,
        isActive: true,
        hubspotObjectId: "campaign-archived",
        hubspotObjectType: "2-CAMPAIGN",
      },
    });
    const run = await createSyncRun(admin.id);

    fetchHubspotCustomObjectsMock.mockImplementation(
      async (input: { objectType: string; archived: boolean }) => {
        if (!input.archived) {
          return { nextAfter: null, results: [] };
        }

        if (input.objectType === "2-CLIENT") {
          return {
            nextAfter: null,
            results: [{ id: "client-archived", archived: true, properties: {} }],
          };
        }

        return {
          nextAfter: null,
          results: [{ id: "campaign-archived", archived: true, properties: {} }],
        };
      },
    );

    const result = await objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });

    expect(result.deactivatedCount).toBe(2);
    await expect(prisma.client.findUniqueOrThrow({ where: { id: client.id } })).resolves.toMatchObject({
      isActive: false,
      hubspotArchived: true,
    });
    await expect(prisma.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).resolves.toMatchObject({
      isActive: false,
      hubspotArchived: true,
    });
  });

  it("imports HubSpot campaigns with missing optional local fields", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);

    fetchHubspotCustomObjectsMock.mockImplementation(async (input: { objectType: string; archived: boolean }) => {
      if (input.objectType === "2-CLIENT" && !input.archived) {
        return {
          nextAfter: null,
          results: [
            {
              id: "client-101",
              archived: false,
              properties: {
                client_name: "Client A",
                active: "true",
              },
            },
          ],
        };
      }

      if (input.objectType === "2-CAMPAIGN" && !input.archived) {
        return {
          nextAfter: null,
          results: [
            {
              id: "campaign-missing-metadata",
              archived: false,
              properties: {
                campaign_name: "Missing Metadata",
                client_object_id: null,
                market: null,
                month: null,
                year: null,
                status: "Planned",
                active: "true",
              },
            },
            {
              id: "campaign-valid",
              archived: false,
              properties: {
                campaign_name: "Valid Campaign",
                client_object_id: "client-101",
                market: "Croatia",
                month: "April",
                year: "2026",
                status: "In progress",
                active: "true",
              },
            },
          ],
        };
      }

      return { nextAfter: null, results: [] };
    });

    const result = await objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });

    expect(result.status).toBe("completed");
    expect(result.campaignUpsertCount).toBe(2);
    expect(result.lastError).toBeNull();

    await expect(
      prisma.campaign.findFirstOrThrow({ where: { hubspotObjectId: "campaign-missing-metadata" } }),
    ).resolves.toMatchObject({
      name: "Missing Metadata",
      clientId: null,
      marketId: null,
      month: null,
      year: null,
      status: "Planned",
      isActive: true,
    });
    await expect(
      prisma.campaign.findFirstOrThrow({ where: { hubspotObjectId: "campaign-valid" } }),
    ).resolves.toMatchObject({
      name: "Valid Campaign",
      isActive: true,
    });
  });

  it("updates existing HubSpot campaigns to null optional metadata when HubSpot clears values", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);
    const client = await prisma.client.create({
      data: {
        name: "Client A",
        isActive: true,
        hubspotObjectId: "client-101",
        hubspotObjectType: "2-CLIENT",
      },
    });
    const market = await prisma.market.create({ data: { name: "Croatia" } });
    await prisma.campaign.create({
      data: {
        name: "Existing Campaign",
        clientId: client.id,
        marketId: market.id,
        month: RunMonth.APRIL,
        year: 2026,
        isActive: true,
        hubspotObjectId: "campaign-201",
        hubspotObjectType: "2-CAMPAIGN",
      },
    });

    fetchHubspotCustomObjectsMock.mockImplementation(async (input: { objectType: string; archived: boolean }) => {
      if (input.objectType === "2-CLIENT" && !input.archived) {
        return {
          nextAfter: null,
          results: [
            {
              id: "client-101",
              archived: false,
              properties: {
                client_name: "Client A",
                active: "true",
              },
            },
          ],
        };
      }

      if (input.objectType === "2-CAMPAIGN" && !input.archived) {
        return {
          nextAfter: null,
          results: [
            {
              id: "campaign-201",
              archived: false,
              properties: {
                campaign_name: "Existing Campaign",
                client_object_id: null,
                market: null,
                month: null,
                year: null,
                status: "Cancelled",
                active: "true",
              },
            },
          ],
        };
      }

      return { nextAfter: null, results: [] };
    });

    const result = await objectSync.executeHubspotObjectSyncRun({
      syncRunId: run.id,
      requestedByUserId: admin.id,
    });

    expect(result.status).toBe("completed");
    expect(result.campaignUpsertCount).toBe(1);
    expect(result.lastError).toBeNull();

    await expect(
      prisma.campaign.findFirstOrThrow({ where: { hubspotObjectId: "campaign-201" } }),
    ).resolves.toMatchObject({
      name: "Existing Campaign",
      clientId: null,
      marketId: null,
      month: null,
      year: null,
      status: "Cancelled",
      isActive: true,
    });
  });

  it("fails durably when required HubSpot mapping env vars are missing", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);
    delete process.env.HUBSPOT_CLIENT_OBJECT_TYPE;

    await expect(
      objectSync.executeHubspotObjectSyncRun({
        syncRunId: run.id,
        requestedByUserId: admin.id,
      }),
    ).rejects.toThrow("HUBSPOT_CLIENT_OBJECT_TYPE is required");

    const failedRun = await prisma.hubspotObjectSyncRun.findUniqueOrThrow({
      where: {
        id: run.id,
      },
    });
    expect(failedRun.status).toBe("FAILED");
    expect(failedRun.completedAt).not.toBeNull();
    expect(failedRun.lastError).toContain("HUBSPOT_CLIENT_OBJECT_TYPE");
    expect(fetchHubspotCustomObjectsMock).not.toHaveBeenCalled();
  });

  it("fails the sync run when dropdown value sync fails", async () => {
    const objectSync = await loadObjectSync();
    const admin = await createAdmin();
    const run = await createSyncRun(admin.id);

    fetchHubspotCustomObjectsMock.mockResolvedValue({ nextAfter: null, results: [] });
    fetchHubspotAccountDetailsMock.mockRejectedValueOnce(new Error("HubSpot dropdown sync failed"));

    await expect(
      objectSync.executeHubspotObjectSyncRun({
        syncRunId: run.id,
        requestedByUserId: admin.id,
      }),
    ).rejects.toThrow("HubSpot dropdown sync failed");

    const failedRun = await prisma.hubspotObjectSyncRun.findUniqueOrThrow({
      where: {
        id: run.id,
      },
    });
    expect(failedRun.status).toBe("FAILED");
    expect(failedRun.completedAt).not.toBeNull();
    expect(failedRun.lastError).toContain("HubSpot dropdown sync failed");

    await expect(
      prisma.hubspotPortal.findUniqueOrThrow({ where: { portalId: "12345" } }),
    ).resolves.toMatchObject({
      objectSyncLeaseOwner: null,
      objectSyncLeaseExpiresAt: null,
    });
  });
});
