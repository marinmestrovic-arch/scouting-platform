import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type ExtensionContextModule = typeof import("./extension-context");

integration("HubSpot extension context authorization", () => {
  let prisma: PrismaClient;
  let extensionContext: ExtensionContextModule;

  const ownerEmail = "extension-owner@example.com";
  const otherEmail = "extension-other@example.com";
  const adminEmail = "extension-admin@example.com";
  const inactiveEmail = "extension-inactive@example.com";

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });
    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    vi.resetModules();
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_portals,
        users,
        channels,
        campaigns
      RESTART IDENTITY CASCADE
    `);
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    extensionContext = await import("./extension-context");
  });

  afterAll(async () => {
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  async function seedLinkedOwnerRun(): Promise<{ runId: string }> {
    const [owner, portal] = await Promise.all([
      prisma.user.create({
        data: {
          email: ownerEmail,
          passwordHash: "test-password-hash",
          role: Role.USER,
        },
      }),
      prisma.hubspotPortal.create({
        data: { portalId: "12345" },
      }),
    ]);
    await prisma.user.createMany({
      data: [
        {
          email: otherEmail,
          passwordHash: "test-password-hash",
          role: Role.USER,
        },
        {
          email: adminEmail,
          passwordHash: "test-password-hash",
          role: Role.ADMIN,
        },
        {
          email: inactiveEmail,
          passwordHash: "test-password-hash",
          role: Role.USER,
          isActive: false,
        },
      ],
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: "Extension campaign",
        hubspotPortalId: portal.id,
        hubspotObjectId: "campaign-300",
        hubspotObjectType: "2-campaign",
        hubspotSyncedAt: new Date("2026-07-20T10:00:00.000Z"),
      },
    });
    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: owner.id,
        name: "Owner run",
        query: "gaming creators",
        campaignId: campaign.id,
        campaignName: campaign.name,
      },
    });
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-extension-owner",
        title: "Extension Creator",
        handle: "@extensioncreator",
        metrics: {
          create: {
            youtubeFollowers: 125_000,
            youtubeVideoMedianViews: 45_000,
            youtubeEngagementRate: 4.2,
          },
        },
      },
    });
    const contact = await prisma.channelContact.create({
      data: {
        channelId: channel.id,
        email: "creator@example.com",
        firstName: "Test",
        lastName: "Creator",
      },
    });
    await prisma.hubspotContactLink.create({
      data: {
        hubspotPortalId: portal.id,
        channelContactId: contact.id,
        hubspotObjectId: "contact-100",
        externalKey: `contact:${contact.id}`,
        lastSuccessfulSyncAt: new Date("2026-07-20T10:15:00.000Z"),
      },
    });
    await prisma.hubspotDealLink.create({
      data: {
        hubspotPortalId: portal.id,
        runRequestId: run.id,
        hubspotObjectId: "deal-200",
        externalKey: `run:${run.id}`,
        lastSuccessfulSyncAt: new Date("2026-07-20T10:20:00.000Z"),
      },
    });
    const batch = await prisma.hubspotImportBatch.create({
      data: {
        requestedByUserId: owner.id,
        runRequestId: run.id,
        hubspotPortalId: portal.id,
        fileName: "extension-owner-run.csv",
        schemaVersion: "v2",
      },
    });
    await prisma.hubspotImportBatchRow.create({
      data: {
        batchId: batch.id,
        channelId: channel.id,
        channelContactId: contact.id,
        contactEmail: contact.email,
        firstName: contact.firstName ?? "",
        lastName: contact.lastName ?? "",
        payload: {},
      },
    });

    return { runId: run.id };
  }

  function contextFor(input: {
    userEmail: string;
    objectId: string;
    objectType: string;
  }) {
    return extensionContext.getHubspotExtensionContext({
      portalId: "12345",
      platformBaseUrl: "https://scouting.example.com",
      ...input,
    });
  }

  async function loadAllObjectContexts(userEmail: string) {
    return Promise.all([
      contextFor({ userEmail, objectId: "contact-100", objectType: "0-1" }),
      contextFor({ userEmail, objectId: "deal-200", objectType: "0-3" }),
      contextFor({
        userEmail,
        objectId: "campaign-300",
        objectType: "2-campaign",
      }),
    ]);
  }

  it("rejects an inactive platform user before returning any linked context", async () => {
    await seedLinkedOwnerRun();

    await expect(
      contextFor({
        userEmail: inactiveEmail,
        objectId: "deal-200",
        objectType: "0-3",
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_EXTENSION_FORBIDDEN",
      status: 403,
    });
  });

  it("does not expose another user's run through contact, deal, or custom-object context", async () => {
    await seedLinkedOwnerRun();

    const contexts = await loadAllObjectContexts(otherEmail);

    expect(contexts.map((context) => context.run)).toEqual([null, null, null]);
    expect(contexts[0]?.creator?.name).toBe("Extension Creator");
    expect(contexts[1]?.sync.status).toBe("not_linked");
  });

  it("returns an owner's run through contact, deal, and custom-object context", async () => {
    const { runId } = await seedLinkedOwnerRun();

    const contexts = await loadAllObjectContexts(ownerEmail.toUpperCase());

    expect(contexts.map((context) => context.run?.id)).toEqual([
      runId,
      runId,
      runId,
    ]);
  });

  it("allows an admin to read the linked run through every supported object path", async () => {
    const { runId } = await seedLinkedOwnerRun();

    const contexts = await loadAllObjectContexts(adminEmail);

    expect(contexts.map((context) => context.run?.id)).toEqual([
      runId,
      runId,
      runId,
    ]);
  });
});
