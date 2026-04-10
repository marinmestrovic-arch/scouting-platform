import { CredentialProvider, PrismaClient, Role } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CoreModule = typeof import("./index");

integration("week 1 core integration", () => {
  const encryptionKey = "12345678901234567890123456789012";
  let prisma: PrismaClient;
  let core: CoreModule;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.APP_ENCRYPTION_KEY = encryptionKey;

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
  });

  beforeEach(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.APP_ENCRYPTION_KEY = encryptionKey;

    vi.resetModules();

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        run_results,
        run_requests,
        audit_events,
        user_provider_credentials,
        sessions,
        accounts,
        verification_tokens,
        channels,
        users
      RESTART IDENTITY CASCADE
    `);

    const db = await import("@scouting-platform/db");
    await db.resetPrismaClientForTests();
    core = await import("./index");
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

  it("creates users, rejects duplicate email, and lists users", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "admin@example.com",
        name: "Admin",
        role: Role.ADMIN,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    const created = await core.createUser({
      actorUserId: admin.id,
      email: "user@example.com",
      name: "Campaign User",
      role: "user",
      userType: "campaign_manager",
      password: "StrongPassword123",
    });

    expect(created.email).toBe("user@example.com");
    expect(created.role).toBe("user");

    await expect(
      core.createUser({
        actorUserId: admin.id,
        email: "user@example.com",
        name: "Campaign User 2",
        role: "user",
        userType: "campaign_manager",
        password: "StrongPassword123",
      }),
    ).rejects.toMatchObject({
      code: "DUPLICATE_EMAIL",
      status: 409,
    });

    const users = await core.listUsers();
    expect(users).toHaveLength(2);
  });

  it("stores encrypted youtube key and decrypts only server-side", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "admin@example.com",
        name: "Admin",
        role: Role.ADMIN,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    const user = await core.createUser({
      actorUserId: admin.id,
      email: "campaign@example.com",
      name: "Campaign User",
      role: "user",
      userType: "campaign_manager",
      password: "StrongPassword123",
    });

    await core.setUserYoutubeApiKey({
      userId: user.id,
      rawKey: "yt-secret-key",
      actorUserId: admin.id,
    });

    const stored = await prisma.userProviderCredential.findUnique({
      where: {
        userId_provider: {
          userId: user.id,
          provider: CredentialProvider.YOUTUBE_DATA_API,
        },
      },
    });

    expect(stored).not.toBeNull();
    expect(stored?.encryptedSecret).not.toBe("yt-secret-key");

    const decrypted = await core.getUserYoutubeApiKey(user.id);
    expect(decrypted).toBe("yt-secret-key");
  });

  it("returns an empty-safe channel list on clean database", async () => {
    const result = await core.listChannels({
      page: 1,
      pageSize: 20,
    });

    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});
