import { PrismaClient, Role, UserType } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { COUNTRY_REGION_OPTIONS } from "@scouting-platform/contracts";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CampaignsModule = typeof import("./campaigns");

integration("campaigns core integration", () => {
  let prisma: PrismaClient;
  let campaigns: CampaignsModule;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    const { createPrismaClient } = await import("@scouting-platform/db");
    prisma = createPrismaClient({
      databaseUrl,
    });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    vi.resetModules();

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        campaigns,
        markets,
        clients,
        audit_events,
        user_provider_credentials,
        sessions,
        accounts,
        verification_tokens,
        users
      RESTART IDENTITY CASCADE
    `);

    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    campaigns = await import("./campaigns");
  });

  afterEach(async () => {
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
  });

  afterAll(async () => {
    vi.resetModules();
    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    await prisma.$disconnect();
  });

  it("hydrates market reference options during campaign listing when the table starts empty", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "admin@example.com",
        name: "Admin",
        role: Role.ADMIN,
        userType: UserType.ADMIN,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    const result = await campaigns.listCampaigns({
      userId: admin.id,
    });

    const marketNames = result.filterOptions.markets.map((market) => market.name);

    expect(marketNames).toHaveLength(COUNTRY_REGION_OPTIONS.length);
    expect(marketNames).toEqual(expect.arrayContaining([...COUNTRY_REGION_OPTIONS]));

    const marketCount = await prisma.market.count();
    expect(marketCount).toBe(COUNTRY_REGION_OPTIONS.length);
  });
});
