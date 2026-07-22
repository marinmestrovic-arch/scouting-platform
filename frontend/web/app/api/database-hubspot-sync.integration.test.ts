import { PrismaClient, Role, UserType } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("database HubSpot sync API integration", () => {
  let prisma: PrismaClient;
  let route: typeof import("./database/hubspot-sync/route");
  let core: typeof import("@scouting-platform/core");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "database-hubspot-sync-api-secret";

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
    core = await import("@scouting-platform/core");
    route = await import("./database/hubspot-sync/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;
    await core.stopHubspotObjectSyncQueue();

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_object_sync_runs,
        audit_events,
        user_provider_credentials,
        sessions,
        accounts,
        verification_tokens,
        users
      RESTART IDENTITY CASCADE
    `);

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'hubspot.object-sync'
    `);
  });

  afterEach(async () => {
    await core.stopHubspotObjectSyncQueue();
  });

  afterAll(async () => {
    await core.stopHubspotObjectSyncQueue();
    await prisma.$disconnect();
  });

  async function createUser(input: {
    email: string;
    role: Role;
    userType: UserType;
  }): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email: input.email,
        name: input.role === Role.ADMIN ? "Admin" : "Manager",
        role: input.role,
        userType: input.userType,
        passwordHash: "hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  it("requires admin auth, creates sync runs, and lists recent status", async () => {
    const unauthenticatedResponse = await route.GET();
    expect(unauthenticatedResponse.status).toBe(401);

    const manager = await createUser({
      email: "manager@example.com",
      role: Role.USER,
      userType: UserType.CAMPAIGN_MANAGER,
    });
    currentSessionUser = { id: manager.id, role: "user" };

    const forbiddenResponse = await route.POST();
    expect(forbiddenResponse.status).toBe(403);

    const admin = await createUser({
      email: "admin@example.com",
      role: Role.ADMIN,
      userType: UserType.ADMIN,
    });
    currentSessionUser = { id: admin.id, role: "admin" };

    const createResponse = await route.POST();
    expect(createResponse.status).toBe(202);
    const createPayload = await createResponse.json();
    expect(createPayload.run.status).toBe("queued");
    expect(createPayload.run.objectTypes).toEqual([
      "clients",
      "campaigns",
      "dropdownValues",
      "owners",
      "pipelines",
      "associationDefinitions",
      "schemas",
      "collaborationHistory",
    ]);

    const otherAdmin = await createUser({
      email: "other-admin@example.com",
      role: Role.ADMIN,
      userType: UserType.ADMIN,
    });
    await prisma.hubspotObjectSyncRun.create({
      data: {
        requestedByUserId: otherAdmin.id,
        objectTypes: ["clients", "campaigns", "dropdownValues"],
      },
    });

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'hubspot.object-sync'
    `;
    expect(jobs[0]?.count).toBe(1);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        action: "hubspot_object_sync.requested",
        entityType: "hubspot_object_sync_run",
        entityId: createPayload.run.id,
      },
    });
    expect(audit).not.toBeNull();

    const listResponse = await route.GET();
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.items).toHaveLength(2);
    expect(listPayload.items.map((item: { id: string }) => item.id)).toContain(createPayload.run.id);
  });
});
