import {
  HUBSPOT_IMPORT_HEADER,
} from "@scouting-platform/contracts";
import {
  HubspotAssociationStatus,
  HubspotDeliveryMode,
  HubspotExternalDeliveryStatus,
  HubspotImportBatchRowStatus,
  HubspotImportBatchStatus,
  HubspotPortalHealthStatus,
  HubspotPushBatchRowStatus,
  HubspotPushBatchStatus,
  DropdownValueFieldKey,
  type Prisma,
  PrismaClient,
  Role,
} from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

const {
  associationsMock,
  contactUpdatesMock,
  contactsMock,
  dealsMock,
  enqueueMock,
} = vi.hoisted(() => ({
  associationsMock: vi.fn(),
  contactUpdatesMock: vi.fn(),
  contactsMock: vi.fn(),
  dealsMock: vi.fn(),
  enqueueMock: vi.fn(),
}));

vi.mock("@scouting-platform/integrations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@scouting-platform/integrations")>();
  return {
    ...actual,
    batchUpdateHubspotContacts: contactUpdatesMock,
    batchUpsertHubspotContacts: contactsMock,
    batchUpsertHubspotDeals: dealsMock,
    createHubspotAssociations: associationsMock,
  };
});

vi.mock("./queue", () => ({
  enqueueHubspotImportJob: enqueueMock,
}));

type DirectSyncModule = typeof import("./direct-sync-service");

integration("HubSpot direct sync lifecycle", () => {
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
    vi.clearAllMocks();
    enqueueMock.mockResolvedValue(undefined);
    associationsMock.mockImplementation(async (input: {
      associations: Array<{ fromId: string; toId: string }>;
    }) => ({
      submitted: input.associations.length,
      accepted: input.associations.length,
      errors: [],
      outcomes: input.associations.map((association, inputIndex) => ({
        inputIndex,
        fromId: association.fromId,
        toId: association.toId,
        success: true,
        error: null,
      })),
    }));
    dealsMock.mockImplementation(async (input: { records: Array<{ objectWriteTraceId: string }> }) => ({
      outcomes: [
        {
          inputIndex: 0,
          objectWriteTraceId: input.records[0]!.objectWriteTraceId,
          success: true,
          id: "deal-900",
          created: true,
          properties: {},
        },
      ],
      succeeded: 1,
      failed: 0,
    }));
    contactUpdatesMock.mockImplementation(async (input: {
      records: Array<{ id: string; objectWriteTraceId: string }>;
    }) => ({
      outcomes: input.records.map((record, inputIndex) => ({
        inputIndex,
        objectWriteTraceId: record.objectWriteTraceId,
        success: true,
        id: record.id,
        created: false,
        properties: {},
      })),
      succeeded: input.records.length,
      failed: 0,
    }));
    contactsMock.mockImplementation(async (input: { records: Array<{ objectWriteTraceId: string }> }) => ({
      outcomes: input.records.map((record, inputIndex) => ({
        inputIndex,
        objectWriteTraceId: record.objectWriteTraceId,
        success: true,
        id: `contact-${inputIndex + 1}`,
        created: true,
        properties: {},
      })),
      succeeded: input.records.length,
      failed: 0,
    }));

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

  async function loadDirectSync(): Promise<DirectSyncModule> {
    return import("./direct-sync-service");
  }

  async function seedBatch(options: {
    dealCampaignAssociationTypeIds?: number[];
  } = {}): Promise<{
    batchId: string;
    userId: string;
    runId: string;
    channelId: string;
    rowIds: string[];
  }> {
    const user = await prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Campaign Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
    });
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
        [DropdownValueFieldKey.DEAL_TYPE, "value", "deal_internal"],
        [DropdownValueFieldKey.ACTIVATION_TYPE, "value", "activation_internal"],
        [DropdownValueFieldKey.INFLUENCER_TYPE, "value", "influencer_internal"],
        [DropdownValueFieldKey.INFLUENCER_VERTICAL, "value", "vertical_internal"],
        [DropdownValueFieldKey.COUNTRY_REGION, "value", "country_internal"],
        [DropdownValueFieldKey.LANGUAGE, "value", "language_internal"],
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
        requestedByUserId: user.id,
        campaignManagerUserId: user.id,
        campaignId: campaign.id,
        name: "Direct sync run",
        query: "gaming creators",
        dealName: "Creator shortlist",
        pipeline: "Sales Pipeline",
        dealStage: "Scouted",
        currency: "EUR",
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
    await prisma.hubspotPipelineStage.create({
      data: {
        pipelineId: pipeline.id,
        hubspotStageId: "stage-1",
        label: "Scouted",
        syncedAt: new Date(),
      },
    });
    await prisma.hubspotOwner.create({
      data: {
        hubspotPortalId: portal.id,
        hubspotOwnerId: "owner-1",
        email: user.email,
        normalizedEmail: user.email,
        isActive: true,
        syncedAt: new Date(),
      },
    });
    await prisma.hubspotAssociationDefinition.createMany({
      data: [
        ["contacts", "deals", 1],
        ...(options.dealCampaignAssociationTypeIds ?? [2]).map(
          (associationTypeId) => ["deals", "2-CAMPAIGN", associationTypeId],
        ),
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
    });
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-DIRECT",
        title: "Creator",
        handle: "@creator",
        youtubeUrl: "https://youtube.example/@creator",
        metrics: {
          create: {
            subscriberCount: 150_000n,
            youtubeFollowers: 149_000n,
            youtubeVideoMedianViews: 25_000n,
            youtubeShortsMedianViews: 12_000n,
            youtubeEngagementRate: 3.5,
          },
        },
      },
    });
    const contacts = await Promise.all(
      ["one@example.com", "two@example.com"].map((email, index) =>
        prisma.channelContact.create({
          data: {
            channelId: channel.id,
            email,
            firstName: `Creator${index + 1}`,
            lastName: "Test",
          },
        }),
      ),
    );
    const preparedRows = contacts.map((contact) => ({
      channelId: channel.id,
      channelContactId: contact.id,
      contactEmail: contact.email,
      firstName: contact.firstName!,
      lastName: contact.lastName!,
      externalKey: `contact:${contact.id}`,
      associationStatus: HubspotAssociationStatus.PENDING,
      payload: {
        channelTitle: channel.title,
        providerSnapshot: {
          youtubeChannelId: channel.youtubeChannelId,
          youtubeHandle: channel.handle,
          youtubeUrl: channel.youtubeUrl,
          subscriberCount: "150000",
          youtubeFollowers: "149000",
          youtubeVideoMedianViews: "25000",
          youtubeShortsMedianViews: "12000",
          youtubeEngagementRate: 3.5,
        },
        csv: Object.fromEntries(
          HUBSPOT_IMPORT_HEADER.map((field) => [
            field,
            field === "First Name"
              ? contact.firstName
              : field === "Last Name"
                ? contact.lastName
                : field === "Email"
                  ? contact.email
                  : field === "Deal name"
                    ? "Creator shortlist"
                    : field === "Pipeline"
                      ? "Sales Pipeline"
                      : field === "Deal stage"
                        ? "Scouted"
                        : field === "Currency"
                          ? "EUR"
                          : "value",
          ]),
        ),
      },
    }));
    const service = await loadDirectSync();
    const creationContext = await service.getHubspotDirectSyncCreationContext({
      runId: run.id,
      preparedPayloads: preparedRows.map((row) => row.payload as Prisma.JsonValue),
    });
    const batch = await prisma.hubspotImportBatch.create({
      data: {
        requestedByUserId: user.id,
        runRequestId: run.id,
        hubspotPortalId: portal.id,
        fileName: "direct.csv",
        schemaVersion: "week7-hubspot-import-v2",
        deliveryMode: HubspotDeliveryMode.DIRECT_OBJECT_API,
        directSyncSnapshot: creationContext.snapshot as Prisma.InputJsonValue,
        totalRowCount: contacts.length,
        rows: {
          create: preparedRows,
        },
      },
      include: { rows: { orderBy: { contactEmail: "asc" } } },
    });
    return {
      batchId: batch.id,
      userId: user.id,
      runId: run.id,
      channelId: channel.id,
      rowIds: batch.rows.map((row) => row.id),
    };
  }

  it("uses the configured Deal to Campaign type when the portal has multiple definitions", async () => {
    process.env.HUBSPOT_DEAL_CAMPAIGN_ASSOCIATION_TYPE_ID = "22";

    const { batchId } = await seedBatch({
      dealCampaignAssociationTypeIds: [2, 22],
    });
    const batch = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { directSyncSnapshot: true },
    });

    expect(batch.directSyncSnapshot).toMatchObject({
      dealToCampaign: {
        associationTypeId: 22,
      },
    });
  });

  it("rejects a configured Deal to Campaign type that the portal did not expose", async () => {
    process.env.HUBSPOT_DEAL_CAMPAIGN_ASSOCIATION_TYPE_ID = "999";

    await expect(seedBatch()).rejects.toMatchObject({
      code: "HUBSPOT_ASSOCIATION_REFERENCE_MISSING",
      message: expect.stringContaining("Deal → Campaign association"),
    });
  });

  it("keeps legacy version-1 batches resumable without inventing a new graph edge", async () => {
    const { batchId, userId } = await seedBatch();
    const batch = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      select: { directSyncSnapshot: true },
    });
    const legacySnapshot = JSON.parse(JSON.stringify(batch.directSyncSnapshot)) as Record<
      string,
      unknown
    >;
    legacySnapshot.version = 1;
    delete legacySnapshot.dealToClient;
    await prisma.hubspotImportBatch.update({
      where: { id: batchId },
      data: { directSyncSnapshot: legacySnapshot as Prisma.InputJsonValue },
    });
    const service = await loadDirectSync();
    const payload = { importBatchId: batchId, requestedByUserId: userId };

    await service.executeDirectHubspotImportBatch(payload);
    await service.executeDirectHubspotImportBatch(payload);
    await service.executeDirectHubspotImportBatch(payload);

    const completed = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(completed.status).toBe(HubspotImportBatchStatus.COMPLETED);
    expect(completed.providerResultSummary).toMatchObject({
      dealClientAssociation: { status: "not_required_legacy_snapshot" },
    });
    expect(associationsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        fromObjectType: "deals",
        toObjectType: "2-CLIENT",
      }),
    );
  });

  it("persists contact/deal links, associations, completion, and failed-row-only retry", async () => {
    const { batchId, userId, runId, channelId, rowIds } = await seedBatch();
    const service = await loadDirectSync();
    const payload = { importBatchId: batchId, requestedByUserId: userId };

    await service.executeDirectHubspotImportBatch(payload);
    expect((await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } })).status)
      .toBe(HubspotImportBatchStatus.SUBMITTING);

    await prisma.channelMetric.update({
      where: { channelId },
      data: {
        youtubeFollowers: 999_999n,
        youtubeVideoMedianViews: 999_999n,
      },
    });
    await prisma.runRequest.update({
      where: { id: runId },
      data: {
        dealName: "Mutated after confirmation",
        pipeline: "Mutated pipeline",
        dealStage: "Mutated stage",
        currency: "USD",
      },
    });

    await service.executeDirectHubspotImportBatch(payload);
    expect((await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } })).status)
      .toBe(HubspotImportBatchStatus.PROCESSING);
    expect(dealsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [
          expect.objectContaining({
            properties: expect.objectContaining({
              dealname: "Creator shortlist",
              pipeline: "pipeline-1",
              dealstage: "stage-1",
              hubspot_owner_id: "owner-1",
              deal_currency_code: "EUR",
              dealtype: "deal_internal",
              activation_type: "activation_internal",
            }),
          }),
        ],
      }),
    );
    expect(contactsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        records: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              influencer_type: "influencer_internal",
              influencer_vertical: "vertical_internal",
              country: "country_internal",
              language: "language_internal",
              youtube_url: "https://youtube.example/@creator",
              youtube_followers: "149000",
              youtube_video_median_views: "25000",
              youtube_shorts_median_views: "12000",
              youtube_engagement_rate: "3.5",
              influencer_size: "Macro (100K - 500K)",
            }),
          }),
        ]),
      }),
    );

    await service.executeDirectHubspotImportBatch(payload);
    const completed = await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(completed.status).toBe(HubspotImportBatchStatus.COMPLETED);
    expect(completed.externalStatus).toBe(HubspotExternalDeliveryStatus.COMPLETED);
    expect(completed.syncedRowCount).toBe(2);
    expect(completed.providerResultSummary).toMatchObject({
      associationsCompleted: true,
      dealCampaignAssociation: {
        status: "confirmed",
        dealId: "deal-900",
        campaignId: "campaign-20",
        associationTypeId: 2,
      },
      dealClientAssociation: {
        status: "confirmed",
        dealId: "deal-900",
        clientId: "client-10",
        associationTypeId: 4,
      },
      campaignClientAssociation: {
        status: "confirmed",
        campaignId: "campaign-20",
        clientId: "client-10",
        associationTypeId: 3,
      },
    });
    expect(await prisma.hubspotContactLink.count()).toBe(2);
    expect(await prisma.hubspotDealLink.count()).toBe(1);
    expect(
      await prisma.hubspotImportBatchRow.count({
        where: { batchId, status: HubspotImportBatchRowStatus.SYNCED },
      }),
    ).toBe(2);

    await prisma.$transaction([
      prisma.hubspotImportBatch.update({
        where: { id: batchId },
        data: {
          status: HubspotImportBatchStatus.COMPLETED_WITH_ERRORS,
          externalStatus: HubspotExternalDeliveryStatus.COMPLETED_WITH_ERRORS,
          failedRowCount: 1,
          syncedRowCount: 1,
        },
      }),
      prisma.hubspotImportBatchRow.update({
        where: { id: rowIds[0]! },
        data: {
          status: HubspotImportBatchRowStatus.FAILED,
          associationStatus: HubspotAssociationStatus.FAILED,
          retryable: true,
        },
      }),
    ]);

    const contactCallsBeforeAssociationRetry = contactsMock.mock.calls.length;
    const dealCallsBeforeAssociationRetry = dealsMock.mock.calls.length;
    await expect(service.retryDirectHubspotImportBatch({
      importBatchId: batchId,
      batchOwnerUserId: userId,
      actorUserId: userId,
    })).resolves.toBe(1);
    expect(
      (await prisma.hubspotImportBatchRow.findUniqueOrThrow({ where: { id: rowIds[0]! } })).status,
    ).toBe(HubspotImportBatchRowStatus.SUBMITTING);
    expect(
      (await prisma.hubspotImportBatchRow.findUniqueOrThrow({ where: { id: rowIds[1]! } })).status,
    ).toBe(HubspotImportBatchRowStatus.SYNCED);
    expect(
      (await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } })).status,
    ).toBe(HubspotImportBatchStatus.PROCESSING);

    await service.executeDirectHubspotImportBatch(payload);
    expect(contactsMock).toHaveBeenCalledTimes(contactCallsBeforeAssociationRetry);
    expect(dealsMock).toHaveBeenCalledTimes(dealCallsBeforeAssociationRetry);
  });

  it("persists one contact-association failure without failing successful rows", async () => {
    const { batchId, userId, rowIds } = await seedBatch();
    const service = await loadDirectSync();
    const payload = { importBatchId: batchId, requestedByUserId: userId };
    await service.executeDirectHubspotImportBatch(payload);
    await service.executeDirectHubspotImportBatch(payload);
    associationsMock.mockImplementation(async (input: {
      fromObjectType: string;
      toObjectType: string;
      associations: Array<{ fromId: string; toId: string }>;
    }) => {
      const isContactDeal = input.fromObjectType === "contacts" && input.toObjectType === "deals";
      const outcomes = input.associations.map((association, inputIndex) => {
        const failed = isContactDeal && inputIndex === 1;
        const error = failed
          ? {
              inputIndex,
              chunkIndex: 0,
              category: "VALIDATION_ERROR",
              code: "INVALID_ASSOCIATION",
              message: "Contact association was rejected",
            }
          : null;
        return {
          inputIndex,
          fromId: association.fromId,
          toId: association.toId,
          success: !failed,
          error,
        };
      });
      const errors = outcomes.flatMap((outcome) => outcome.error ? [outcome.error] : []);
      return {
        submitted: outcomes.length,
        accepted: outcomes.length - errors.length,
        errors,
        outcomes,
      };
    });

    await service.executeDirectHubspotImportBatch(payload);

    const batch = await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe(HubspotImportBatchStatus.COMPLETED_WITH_ERRORS);
    expect(batch.syncedRowCount).toBe(1);
    expect(batch.failedRowCount).toBe(1);
    const rows = await prisma.hubspotImportBatchRow.findMany({
      where: { id: { in: rowIds } },
      orderBy: { id: "asc" },
    });
    expect(rows.filter((row) => row.status === HubspotImportBatchRowStatus.SYNCED)).toHaveLength(1);
    expect(rows.filter((row) => row.status === HubspotImportBatchRowStatus.FAILED)).toHaveLength(1);
  });

  it("uses legacy object identity first and email only for an unlinked initial contact", async () => {
    const { batchId, userId, channelId, rowIds } = await seedBatch();
    const firstRow = await prisma.hubspotImportBatchRow.findUniqueOrThrow({
      where: { id: rowIds[0]! },
      select: { contactEmail: true },
    });
    await prisma.hubspotPushBatch.create({
      data: {
        requestedByUserId: userId,
        scopePayload: { type: "selected", channelIds: [channelId] },
        status: HubspotPushBatchStatus.COMPLETED,
        totalRowCount: 1,
        pushedRowCount: 1,
        rows: {
          create: {
            channelId,
            contactEmail: firstRow.contactEmail,
            status: HubspotPushBatchRowStatus.PUSHED,
            hubspotObjectId: "legacy-contact-100",
          },
        },
      },
    });
    const service = await loadDirectSync();
    const payload = { importBatchId: batchId, requestedByUserId: userId };

    await service.executeDirectHubspotImportBatch(payload);
    await service.executeDirectHubspotImportBatch(payload);

    expect(contactUpdatesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        records: [
          expect.objectContaining({
            id: "legacy-contact-100",
            properties: expect.objectContaining({
              atlas_contact_id: expect.stringMatching(/^contact:/),
            }),
          }),
        ],
      }),
    );
    expect(contactsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowEmailIdentifierForFullUpsert: true,
        records: [
          expect.objectContaining({
            id: "two@example.com",
            idProperty: "email",
          }),
        ],
      }),
    );
  });

  it("uses the durable custom unique key for an already linked contact", async () => {
    const { batchId, userId, rowIds } = await seedBatch();
    const linkedRow = await prisma.hubspotImportBatchRow.findUniqueOrThrow({
      where: { id: rowIds[0]! },
      select: { channelContactId: true, externalKey: true },
    });
    await prisma.hubspotContactLink.create({
      data: {
        hubspotPortalId: (await prisma.hubspotImportBatch.findUniqueOrThrow({
          where: { id: batchId },
          select: { hubspotPortalId: true },
        })).hubspotPortalId!,
        channelContactId: linkedRow.channelContactId!,
        hubspotObjectId: "linked-contact-100",
        externalKey: linkedRow.externalKey!,
      },
    });
    const service = await loadDirectSync();
    const payload = { importBatchId: batchId, requestedByUserId: userId };

    await service.executeDirectHubspotImportBatch(payload);
    await service.executeDirectHubspotImportBatch(payload);

    expect(contactUpdatesMock).not.toHaveBeenCalled();
    expect(contactsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        records: expect.arrayContaining([
          expect.objectContaining({
            id: linkedRow.externalKey,
            idProperty: "atlas_contact_id",
            properties: expect.objectContaining({
              atlas_contact_id: linkedRow.externalKey,
            }),
          }),
        ]),
      }),
    );
    expect(contactsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        records: expect.arrayContaining([
          expect.objectContaining({ idProperty: "hs_object_id" }),
        ]),
      }),
    );
  });

  it("resumes a batch-scoped phase failure and recovers from retry enqueue failure", async () => {
    const { batchId, userId } = await seedBatch();
    const service = await loadDirectSync();
    const payload = { importBatchId: batchId, requestedByUserId: userId };
    const retryPayload = {
      importBatchId: batchId,
      batchOwnerUserId: userId,
      actorUserId: userId,
    };

    await service.executeDirectHubspotImportBatch(payload);
    await prisma.hubspotImportBatch.update({
      where: { id: batchId },
      data: {
        status: HubspotImportBatchStatus.FAILED,
        externalStatus: HubspotExternalDeliveryStatus.FAILED,
        completedAt: new Date(),
        lastError: "Provider transport retry budget exhausted",
      },
    });

    enqueueMock.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(service.retryDirectHubspotImportBatch(retryPayload)).rejects.toThrow(
      "queue unavailable",
    );
    const enqueueFailed = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(enqueueFailed.status).toBe(HubspotImportBatchStatus.FAILED);
    expect(enqueueFailed.lastError).toContain("HubSpot sync queue unavailable");

    enqueueMock.mockResolvedValue(undefined);
    await expect(service.retryDirectHubspotImportBatch(retryPayload)).resolves.toBe(2);
    expect(
      (await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } })).status,
    ).toBe(HubspotImportBatchStatus.SUBMITTING);

    await service.executeDirectHubspotImportBatch(payload);
    expect(
      (await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } })).status,
    ).toBe(HubspotImportBatchStatus.PROCESSING);
  });

  it("does not fail a batch or clear ownership when retry enqueue races an active lease", async () => {
    const { batchId, userId } = await seedBatch();
    const service = await loadDirectSync();
    const leaseExpiresAt = new Date(Date.now() + 60_000);
    await prisma.hubspotImportBatch.update({
      where: { id: batchId },
      data: {
        status: HubspotImportBatchStatus.SUBMITTING,
        phaseLeaseOwner: "active-worker",
        phaseLeaseExpiresAt: leaseExpiresAt,
      },
    });

    await service.markDirectHubspotEnqueueFailure({
      importBatchId: batchId,
      batchOwnerUserId: userId,
      actorUserId: userId,
      error: new Error("racing queue failure"),
    });

    const batch = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch).toMatchObject({
      status: HubspotImportBatchStatus.SUBMITTING,
      phaseLeaseOwner: "active-worker",
      phaseLeaseExpiresAt: leaseExpiresAt,
    });
    expect(
      await prisma.auditEvent.count({
        where: { entityId: batchId, action: "hubspot_sync.enqueue_failed" },
      }),
    ).toBe(0);
  });

  it("rethrows when an active-lease handoff cannot leave a durable successor", async () => {
    const { batchId, userId } = await seedBatch();
    const service = await loadDirectSync();
    const payload = { importBatchId: batchId, requestedByUserId: userId };
    const leaseExpiresAt = new Date(Date.now() + 60_000);
    await prisma.hubspotImportBatch.update({
      where: { id: batchId },
      data: {
        status: HubspotImportBatchStatus.PREPARING,
        phaseLeaseOwner: "worker-a",
        phaseLeaseExpiresAt: leaseExpiresAt,
      },
    });
    enqueueMock.mockRejectedValueOnce(new Error("handoff queue unavailable"));

    await expect(service.executeDirectHubspotImportBatch(payload)).rejects.toThrow(
      "handoff queue unavailable",
    );

    expect(
      await prisma.hubspotImportBatch.findUniqueOrThrow({ where: { id: batchId } }),
    ).toMatchObject({
      status: HubspotImportBatchStatus.PREPARING,
      phaseLeaseOwner: "worker-a",
      phaseLeaseExpiresAt: leaseExpiresAt,
    });
  });

  it("durably defers an active phase lease and reclaims it only after expiration", async () => {
    const { batchId, userId } = await seedBatch();
    const service = await loadDirectSync();
    const payload = { importBatchId: batchId, requestedByUserId: userId };
    await prisma.hubspotImportBatch.update({
      where: { id: batchId },
      data: {
        status: HubspotImportBatchStatus.PREPARING,
        phaseLeaseOwner: "worker-a",
        phaseLeaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await service.executeDirectHubspotImportBatch(payload);
    const stillClaimed = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(stillClaimed.status).toBe(HubspotImportBatchStatus.PREPARING);
    expect(stillClaimed.phaseLeaseOwner).toBe("worker-a");
    expect(enqueueMock).toHaveBeenCalledWith(payload, { startAfterSeconds: 30 });

    await prisma.hubspotImportBatch.update({
      where: { id: batchId },
      data: { phaseLeaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    enqueueMock.mockClear();
    await service.executeDirectHubspotImportBatch(payload);
    const reclaimed = await prisma.hubspotImportBatch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(reclaimed.status).toBe(HubspotImportBatchStatus.SUBMITTING);
    expect(reclaimed.phaseLeaseOwner).toBeNull();
    expect(reclaimed.phaseLeaseExpiresAt).toBeNull();
    expect(enqueueMock).toHaveBeenCalledWith(payload, { startAfterSeconds: 1 });
  });
});
