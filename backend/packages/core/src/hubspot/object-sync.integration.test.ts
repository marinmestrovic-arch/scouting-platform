import { PrismaClient, Role, RunMonth } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

const {
  fetchHubspotAssociationsMock,
  fetchHubspotCustomObjectsMock,
  fetchHubspotAccountDetailsMock,
  fetchHubspotPropertyDefinitionMock,
} = vi.hoisted(() => ({
  fetchHubspotAssociationsMock: vi.fn(),
  fetchHubspotCustomObjectsMock: vi.fn(),
  fetchHubspotAccountDetailsMock: vi.fn(),
  fetchHubspotPropertyDefinitionMock: vi.fn(),
}));

vi.mock("@scouting-platform/integrations", () => ({
  fetchHubspotAssociations: fetchHubspotAssociationsMock,
  fetchHubspotCustomObjects: fetchHubspotCustomObjectsMock,
  fetchHubspotAccountDetails: fetchHubspotAccountDetailsMock,
  fetchHubspotPropertyDefinition: fetchHubspotPropertyDefinitionMock,
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
    fetchHubspotAccountDetailsMock.mockResolvedValue({
      companyCurrency: null,
      additionalCurrencies: [],
    });
    fetchHubspotPropertyDefinitionMock.mockResolvedValue({
      name: "property",
      label: "Property",
      type: "enumeration",
      options: [],
    });

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_object_sync_runs,
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
    process.env.HUBSPOT_CLIENT_OBJECT_TYPE = "2-CLIENT";
    process.env.HUBSPOT_CAMPAIGN_OBJECT_TYPE = "2-CAMPAIGN";
    process.env.HUBSPOT_CLIENT_NAME_PROPERTY = "client_name";
    process.env.HUBSPOT_CLIENT_DOMAIN_PROPERTY = "domain";
    process.env.HUBSPOT_CLIENT_COUNTRY_REGION_PROPERTY = "country";
    process.env.HUBSPOT_CLIENT_CITY_PROPERTY = "city";
    process.env.HUBSPOT_CLIENT_ACTIVE_PROPERTY = "active";
    process.env.HUBSPOT_CAMPAIGN_NAME_PROPERTY = "campaign_name";
    process.env.HUBSPOT_CAMPAIGN_CLIENT_OBJECT_ID_PROPERTY = "client_object_id";
    process.env.HUBSPOT_CAMPAIGN_MARKET_PROPERTY = "market";
    process.env.HUBSPOT_CAMPAIGN_BRIEF_LINK_PROPERTY = "brief";
    process.env.HUBSPOT_CAMPAIGN_MONTH_PROPERTY = "month";
    process.env.HUBSPOT_CAMPAIGN_YEAR_PROPERTY = "year";
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

  it("lists sync runs scoped to the requesting admin", async () => {
    const objectSync = await loadObjectSync();
    const adminA = await createAdmin("admin-a@example.com");
    const adminB = await createAdmin("admin-b@example.com");
    const runA = await createSyncRun(adminA.id);
    const runB = await createSyncRun(adminB.id);

    const listed = await objectSync.listHubspotObjectSyncRuns({
      requestedByUserId: adminA.id,
    });

    expect(listed.items.map((item) => item.id)).toContain(runA.id);
    expect(listed.items.map((item) => item.id)).not.toContain(runB.id);
    expect(listed.latest?.id).toBe(runA.id);
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
  });

  it("deletes HubSpot-sourced records that are no longer active in HubSpot", async () => {
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
    expect(result.deactivatedCount).toBe(2);
    await expect(prisma.campaign.findUnique({ where: { id: campaign.id } })).resolves.toBeNull();
    await expect(prisma.client.findUnique({ where: { id: client.id } })).resolves.toBeNull();
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
  });
});
