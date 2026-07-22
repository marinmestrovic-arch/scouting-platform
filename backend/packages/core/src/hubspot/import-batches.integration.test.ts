import {
  DropdownValueFieldKey,
  HubspotDeliveryMode,
  HubspotExternalDeliveryStatus,
  HubspotImportBatchStatus,
  HubspotPortalHealthStatus,
  PrismaClient,
  Role,
  RunMonth,
  RunResultSource,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

const { enqueueMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
}));

vi.mock("./queue", () => ({
  enqueueHubspotImportJob: enqueueMock,
}));

type ImportBatchesModule = typeof import("./import-batches");

integration("HubSpot import batch creation durability", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });
    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.HUBSPOT_ACCESS_TOKEN = "test-only-token";
    process.env.HUBSPOT_PORTAL_ID = "12345";
    process.env.HUBSPOT_DIRECT_SYNC_ENABLED = "true";
    process.env.HUBSPOT_CONTACT_UNIQUE_ID_PROPERTY = "atlas_contact_id";
    process.env.HUBSPOT_DEAL_UNIQUE_ID_PROPERTY = "atlas_run_id";
    process.env.HUBSPOT_CLIENT_OBJECT_TYPE = "2-CLIENT";
    process.env.HUBSPOT_CAMPAIGN_OBJECT_TYPE = "2-CAMPAIGN";
    delete process.env.HUBSPOT_DEAL_CAMPAIGN_ASSOCIATION_TYPE_ID;
    delete process.env.HUBSPOT_DEAL_CLIENT_ASSOCIATION_TYPE_ID;
    delete process.env.HUBSPOT_CAMPAIGN_CLIENT_ASSOCIATION_TYPE_ID;
    vi.resetModules();
    vi.clearAllMocks();
    enqueueMock.mockResolvedValue(undefined);

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_portals,
        users,
        channels,
        clients,
        campaigns
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

  async function loadImportBatches(): Promise<ImportBatchesModule> {
    return import("./import-batches");
  }

  async function seedImportableRun(): Promise<{
    ownerId: string;
    adminId: string;
    runId: string;
    channelId: string;
    resultId: string;
  }> {
    const [owner, admin] = await Promise.all([
      prisma.user.create({
        data: {
          email: "owner@example.com",
          name: "Run Owner",
          role: Role.USER,
          passwordHash: "hash",
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: "admin@example.com",
          name: "Admin",
          role: Role.ADMIN,
          passwordHash: "hash",
          isActive: true,
        },
      }),
    ]);
    const portal = await prisma.hubspotPortal.create({
      data: {
        portalId: "12345",
        healthStatus: HubspotPortalHealthStatus.HEALTHY,
        healthCheckedAt: new Date(),
      },
    });
    const client = await prisma.client.create({
      data: {
        name: "Client",
        hubspotPortalId: portal.id,
        hubspotObjectId: "client-10",
        hubspotObjectType: "2-CLIENT",
      },
    });
    await prisma.dropdownValue.createMany({
      data: [
        [DropdownValueFieldKey.CURRENCY, "EUR", "EUR"],
        [
          DropdownValueFieldKey.DEAL_TYPE,
          "Influencer Collaboration",
          "influencer_collaboration",
        ],
        [
          DropdownValueFieldKey.ACTIVATION_TYPE,
          "Dedicated Video",
          "dedicated_video",
        ],
      ].map(([fieldKey, label, internalValue]) => ({
        fieldKey: fieldKey as DropdownValueFieldKey,
        value: String(label),
        label: String(label),
        internalValue: String(internalValue),
        source: "hubspot",
        sourceObjectType: "test",
        sourcePropertyName: String(fieldKey),
        hubspotPortalId: portal.id,
        hubspotSyncedAt: new Date(),
      })),
    });
    const campaign = await prisma.campaign.create({
      data: {
        name: "Campaign",
        clientId: client.id,
        hubspotPortalId: portal.id,
        hubspotObjectId: "campaign-20",
        hubspotObjectType: "2-CAMPAIGN",
      },
    });
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: owner.id,
        campaignManagerUserId: owner.id,
        campaignId: campaign.id,
        name: "Importable run",
        query: "gaming creators",
        client: "Client",
        market: "Croatia",
        campaignName: "Campaign",
        month: RunMonth.JULY,
        year: 2026,
        dealOwner: owner.email,
        dealName: "Creator shortlist",
        pipeline: "Sales Pipeline",
        dealStage: "Scouted",
        currency: "EUR",
        dealType: "Influencer Collaboration",
        activationType: "Dedicated Video",
        hubspotInfluencerType: "Creator",
        hubspotInfluencerVertical: "Gaming",
        hubspotCountryRegion: "Croatia",
        hubspotLanguage: "English",
      },
    });
    const pipeline = await prisma.hubspotPipeline.create({
      data: {
        hubspotPortalId: portal.id,
        objectType: "deals",
        hubspotPipelineId: "pipeline-1",
        label: "Sales Pipeline",
        syncedAt: new Date(),
      },
    });
    await Promise.all([
      prisma.hubspotPipelineStage.create({
        data: {
          pipelineId: pipeline.id,
          hubspotStageId: "stage-1",
          label: "Scouted",
          syncedAt: new Date(),
        },
      }),
      prisma.hubspotOwner.create({
        data: {
          hubspotPortalId: portal.id,
          hubspotOwnerId: "owner-1",
          email: owner.email,
          normalizedEmail: owner.email,
          isActive: true,
          syncedAt: new Date(),
        },
      }),
      prisma.hubspotAssociationDefinition.createMany({
        data: [
          ["contacts", "deals", 1],
          ["deals", "2-CAMPAIGN", 2],
          ["deals", "2-CLIENT", 4],
          ["2-CAMPAIGN", "2-CLIENT", 3],
        ].map(([fromObjectType, toObjectType, associationTypeId]) => ({
          hubspotPortalId: portal.id,
          fromObjectType: String(fromObjectType),
          toObjectType: String(toObjectType),
          associationCategory: "HUBSPOT_DEFINED",
          associationTypeId: Number(associationTypeId),
          label: null,
          syncedAt: new Date(),
        })),
      }),
    ]);
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-IMPORT-CREATION",
        title: "Creator",
        handle: "@creator",
        youtubeUrl: "https://youtube.example/@creator",
        influencerType: "Creator",
        influencerVertical: "Gaming",
        countryRegion: "Croatia",
        contentLanguage: "English",
        contacts: {
          create: {
            email: "creator@example.com",
            firstName: "Creator",
            lastName: "Test",
          },
        },
      },
    });
    const result = await prisma.runResult.create({
      data: {
        runRequestId: run.id,
        channelId: channel.id,
        rank: 1,
        source: RunResultSource.CATALOG,
      },
    });

    return {
      ownerId: owner.id,
      adminId: admin.id,
      runId: run.id,
      channelId: channel.id,
      resultId: result.id,
    };
  }

  it("creates a durable handle-only row while optional HubSpot fields are blank", async () => {
    const fixture = await seedImportableRun();
    await prisma.$transaction([
      prisma.channelContact.deleteMany({
        where: { channelId: fixture.channelId },
      }),
      prisma.runRequest.update({
        where: { id: fixture.runId },
        data: {
          currency: null,
          dealType: null,
          activationType: null,
          hubspotInfluencerType: null,
          hubspotInfluencerVertical: null,
          hubspotCountryRegion: null,
          hubspotLanguage: null,
        },
      }),
      prisma.channel.update({
        where: { id: fixture.channelId },
        data: {
          influencerType: null,
          influencerVertical: null,
          countryRegion: null,
          contentLanguage: null,
        },
      }),
      prisma.runHubspotRowOverride.create({
        data: {
          runRequestId: fixture.runId,
          rowKey: `${fixture.resultId}:0`,
          firstName: "@creator",
        },
      }),
    ]);
    const imports = await loadImportBatches();

    await expect(imports.getHubspotImportBlockers({
      runId: fixture.runId,
      requestedByUserId: fixture.ownerId,
      role: "user",
    })).resolves.toEqual([]);

    const created = await imports.createHubspotImportBatch({
      runId: fixture.runId,
      requestedByUserId: fixture.ownerId,
      role: "user",
      deliveryMode: "direct_object_api",
    });
    const batch = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: created.id },
      include: { rows: true },
    });
    const row = batch.rows[0]!;
    const payload = row.payload as { csv?: Record<string, string> };
    const materializedContact = await prisma.channelContact.findUniqueOrThrow({
      where: { id: row.channelContactId! },
    });

    expect(row.contactEmail).toBe("");
    expect(row.firstName).toBe("@creator");
    expect(row.lastName).toBe("");
    expect(row.externalKey).toBe(`contact:${row.channelContactId}`);
    expect(materializedContact).toMatchObject({
      channelId: fixture.channelId,
      email: "",
    });
    expect(payload.csv).toMatchObject({
      Currency: "",
      "Deal Type": "",
      "Activation Type": "",
      "Influencer Type": "",
      Language: "",
      "First Name": "@creator",
      "Last Name": "",
      Email: "",
    });
  });

  it("re-enqueues an admin-reused active batch with the persisted run owner", async () => {
    const fixture = await seedImportableRun();
    const imports = await loadImportBatches();
    const first = await imports.createHubspotImportBatch({
      runId: fixture.runId,
      requestedByUserId: fixture.ownerId,
      role: "user",
      deliveryMode: "direct_object_api",
    });
    enqueueMock.mockClear();

    const reused = await imports.createHubspotImportBatch({
      runId: fixture.runId,
      requestedByUserId: fixture.adminId,
      role: "admin",
      deliveryMode: "direct_object_api",
    });

    expect(reused.id).toBe(first.id);
    expect(reused.reusedActiveBatch).toBe(true);
    expect(reused.requestedBy.id).toBe(fixture.ownerId);
    expect(enqueueMock).toHaveBeenCalledWith({
      importBatchId: first.id,
      requestedByUserId: fixture.ownerId,
    });
    expect(enqueueMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ requestedByUserId: fixture.adminId }),
    );
  });

  it("persists the same creator and campaign Deal name shown in preparation", async () => {
    const fixture = await seedImportableRun();
    const imports = await loadImportBatches();
    const created = await imports.createHubspotImportBatch({
      runId: fixture.runId,
      requestedByUserId: fixture.ownerId,
      role: "user",
      deliveryMode: "direct_object_api",
    });
    const batch = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: created.id },
      select: {
        directSyncSnapshot: true,
        rows: {
          select: { payload: true },
        },
      },
    });
    const rowPayload = batch.rows[0]?.payload as {
      csv?: Record<string, string>;
    } | undefined;
    const snapshot = batch.directSyncSnapshot as {
      dealProperties?: Record<string, string>;
    } | null;

    expect(rowPayload?.csv?.["Deal name"]).toBe("@creator - Campaign");
    expect(snapshot?.dealProperties?.dealname).toBe("@creator - Campaign");
  });

  it("creates a new direct batch when only a pre-graph-version batch exists", async () => {
    const fixture = await seedImportableRun();
    const imports = await loadImportBatches();
    const first = await imports.createHubspotImportBatch({
      runId: fixture.runId,
      requestedByUserId: fixture.ownerId,
      role: "user",
      deliveryMode: "direct_object_api",
    });
    const persisted = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: first.id },
      select: { preparationHash: true },
    });
    expect(persisted.preparationHash).not.toBeNull();
    await prisma.hubspotImportBatch.update({
      where: { id: first.id },
      data: {
        idempotencyKey: `run:${fixture.runId}:${persisted.preparationHash}`,
      },
    });

    const upgraded = await imports.createHubspotImportBatch({
      runId: fixture.runId,
      requestedByUserId: fixture.ownerId,
      role: "user",
      deliveryMode: "direct_object_api",
    });

    expect(upgraded.id).not.toBe(first.id);
    expect(upgraded.reusedActiveBatch).not.toBe(true);
    expect(await prisma.hubspotImportBatch.count()).toBe(2);
  });

  it("lets an admin retry an owner's batch while enqueueing as the owner and auditing the admin", async () => {
    const fixture = await seedImportableRun();
    const imports = await loadImportBatches();
    const created = await imports.createHubspotImportBatch({
      runId: fixture.runId,
      requestedByUserId: fixture.ownerId,
      role: "user",
      deliveryMode: "direct_object_api",
    });
    await prisma.hubspotImportBatch.update({
      where: { id: created.id },
      data: {
        status: HubspotImportBatchStatus.FAILED,
        externalStatus: HubspotExternalDeliveryStatus.FAILED,
        completedAt: new Date(),
        lastError: "queue failed before preparation",
      },
    });
    enqueueMock.mockClear();

    const retried = await imports.retryHubspotImportBatch({
      importBatchId: created.id,
      requestedByUserId: fixture.adminId,
      role: "admin",
    });

    expect(retried.retriedRowCount).toBe(1);
    expect(retried.batch.status).toBe("queued");
    expect(enqueueMock).toHaveBeenCalledWith({
      importBatchId: created.id,
      requestedByUserId: fixture.ownerId,
    });
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        entityId: created.id,
        action: "hubspot_sync.failed_rows_retried",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.actorUserId).toBe(fixture.adminId);
  });

  it("durably fails and audits both CSV and direct batches when enqueueing fails", async () => {
    const fixture = await seedImportableRun();
    const imports = await loadImportBatches();
    enqueueMock.mockRejectedValueOnce(new Error("CSV queue offline"));

    await expect(
      imports.createHubspotImportBatch({
        runId: fixture.runId,
        requestedByUserId: fixture.ownerId,
        role: "user",
        deliveryMode: "csv_fallback",
      }),
    ).rejects.toThrow("CSV queue offline");

    enqueueMock.mockRejectedValueOnce(new Error("direct queue offline"));
    await expect(
      imports.createHubspotImportBatch({
        runId: fixture.runId,
        requestedByUserId: fixture.ownerId,
        role: "user",
        deliveryMode: "direct_object_api",
      }),
    ).rejects.toThrow("direct queue offline");

    const batches = await prisma.hubspotImportBatch.findMany({
      orderBy: { createdAt: "asc" },
    });
    expect(batches).toHaveLength(2);
    const csvBatch = batches.find(
      (batch) => batch.deliveryMode === HubspotDeliveryMode.CSV_FALLBACK,
    );
    const directBatch = batches.find(
      (batch) => batch.deliveryMode === HubspotDeliveryMode.DIRECT_OBJECT_API,
    );
    expect(csvBatch).toMatchObject({
      status: HubspotImportBatchStatus.FAILED,
      externalStatus: null,
    });
    expect(csvBatch?.completedAt).not.toBeNull();
    expect(csvBatch?.lastError).toContain("HubSpot import queue unavailable: CSV queue offline");
    expect(directBatch).toMatchObject({
      status: HubspotImportBatchStatus.FAILED,
      externalStatus: HubspotExternalDeliveryStatus.FAILED,
    });
    expect(directBatch?.completedAt).not.toBeNull();
    expect(directBatch?.lastError).toContain(
      "HubSpot sync queue unavailable: direct queue offline",
    );

    const failureAudits = await prisma.auditEvent.findMany({
      where: {
        action: {
          in: ["hubspot_import.enqueue_failed", "hubspot_sync.enqueue_failed"],
        },
      },
      orderBy: { action: "asc" },
    });
    expect(failureAudits).toHaveLength(2);
    expect(failureAudits.every((audit) => audit.actorUserId === fixture.ownerId)).toBe(true);
    expect(failureAudits.map((audit) => audit.entityId)).toEqual(
      expect.arrayContaining([csvBatch?.id, directBatch?.id]),
    );
  });

  it("keeps an active CSV fallback lease and reclaims a stale crash-left RUNNING batch", async () => {
    const fixture = await seedImportableRun();
    const imports = await loadImportBatches();
    const created = await imports.createHubspotImportBatch({
      runId: fixture.runId,
      requestedByUserId: fixture.ownerId,
      role: "user",
      deliveryMode: "csv_fallback",
    });
    await prisma.hubspotImportBatch.update({
      where: { id: created.id },
      data: {
        status: HubspotImportBatchStatus.RUNNING,
        startedAt: new Date(Date.now() - 30 * 60 * 1_000),
        phaseLeaseOwner: "active-csv-worker",
        phaseLeaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await imports.executeHubspotImportBatch({
      importBatchId: created.id,
      requestedByUserId: fixture.ownerId,
    });
    const active = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(active.status).toBe(HubspotImportBatchStatus.RUNNING);
    expect(active.phaseLeaseOwner).toBe("active-csv-worker");
    expect(active.csvContent).toBeNull();

    await prisma.hubspotImportBatch.update({
      where: { id: created.id },
      data: {
        phaseLeaseOwner: null,
        phaseLeaseExpiresAt: null,
        updatedAt: new Date(Date.now() - 16 * 60 * 1_000),
      },
    });
    await imports.executeHubspotImportBatch({
      importBatchId: created.id,
      requestedByUserId: fixture.ownerId,
    });

    const reclaimed = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(reclaimed.status).toBe(HubspotImportBatchStatus.COMPLETED);
    expect(reclaimed.preparedRowCount).toBe(1);
    expect(reclaimed.csvContent).toContain("creator@example.com");
    expect(reclaimed.phaseLeaseOwner).toBeNull();
    expect(reclaimed.phaseLeaseExpiresAt).toBeNull();
    expect(
      await prisma.auditEvent.count({
        where: { entityId: created.id, action: "hubspot_import.completed" },
      }),
    ).toBe(1);
  });

  it("reloads and reuses the winner when concurrent direct creates race", async () => {
    const fixture = await seedImportableRun();
    const db = await import("@scouting-platform/db");
    const actualWithDbTransaction = db.withDbTransaction;
    let transactionEntrants = 0;
    let releaseTransactions: (() => void) | undefined;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransactions = resolve;
    });
    const transactionSpy = vi.spyOn(db, "withDbTransaction").mockImplementation(
      async (callback, options) => {
        transactionEntrants += 1;
        if (transactionEntrants === 2) {
          releaseTransactions?.();
        }
        await transactionGate;
        return options
          ? actualWithDbTransaction(callback, options)
          : actualWithDbTransaction(callback);
      },
    );
    const imports = await loadImportBatches();
    const createInput = {
      runId: fixture.runId,
      requestedByUserId: fixture.ownerId,
      role: "user" as const,
      deliveryMode: "direct_object_api" as const,
    };

    const results = await Promise.all([
      imports.createHubspotImportBatch(createInput),
      imports.createHubspotImportBatch(createInput),
    ]);
    transactionSpy.mockRestore();

    expect(transactionEntrants).toBe(2);
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(results.filter((result) => result.reusedActiveBatch === true)).toHaveLength(1);
    expect(await prisma.hubspotImportBatch.count()).toBe(1);
    expect(await prisma.hubspotImportBatchRow.count()).toBe(1);
    expect(
      await prisma.auditEvent.count({ where: { action: "hubspot_sync.requested" } }),
    ).toBe(1);
    expect(enqueueMock).toHaveBeenCalledTimes(2);
    expect(enqueueMock).toHaveBeenNthCalledWith(1, {
      importBatchId: results[0]?.id,
      requestedByUserId: fixture.ownerId,
    });
    expect(enqueueMock).toHaveBeenNthCalledWith(2, {
      importBatchId: results[0]?.id,
      requestedByUserId: fixture.ownerId,
    });
  });
});
