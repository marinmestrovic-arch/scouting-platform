import { PrismaClient, Role, UserType } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;
let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("database HubSpot health API integration", () => {
  let prisma: PrismaClient;
  let route: typeof import("./database/hubspot-health/route");
  let core: typeof import("@scouting-platform/core");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "database-hubspot-health-api-secret";

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });
    await prisma.$connect();
    core = await import("@scouting-platform/core");
    route = await import("./database/hubspot-health/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;
    await core.stopHubspotHealthCheckQueue();
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        hubspot_health_check_runs,
        audit_events,
        user_provider_credentials,
        sessions,
        accounts,
        verification_tokens,
        users
      RESTART IDENTITY CASCADE
    `);
    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'hubspot.health-check'
    `);
  });

  afterEach(async () => {
    await core.stopHubspotHealthCheckQueue();
  });

  afterAll(async () => {
    await core.stopHubspotHealthCheckQueue();
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
        role: input.role,
        userType: input.userType,
        passwordHash: "hash",
        isActive: true,
      },
      select: { id: true },
    });
  }

  it("requires admin auth and persists an audited queued run without provider work", async () => {
    await expect(route.GET()).resolves.toMatchObject({ status: 401 });

    const manager = await createUser({
      email: "health-manager@example.com",
      role: Role.USER,
      userType: UserType.CAMPAIGN_MANAGER,
    });
    currentSessionUser = { id: manager.id, role: "user" };
    await expect(route.POST()).resolves.toMatchObject({ status: 403 });

    const admin = await createUser({
      email: "health-admin@example.com",
      role: Role.ADMIN,
      userType: UserType.ADMIN,
    });
    currentSessionUser = { id: admin.id, role: "admin" };

    const response = await route.POST();
    expect(response.status).toBe(202);
    const payload = await response.json();
    expect(payload.latestRun).toMatchObject({
      status: "queued",
      startedAt: null,
      completedAt: null,
      lastError: null,
    });

    const run = await prisma.hubspotHealthCheckRun.findUnique({
      where: { id: payload.latestRun.id },
    });
    expect(run).toMatchObject({
      requestedByUserId: admin.id,
      status: "QUEUED",
      startedAt: null,
      completedAt: null,
      lastError: null,
    });
    expect(run?.queuedAt).toBeInstanceOf(Date);

    const jobs = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pgboss.job
      WHERE name = 'hubspot.health-check'
    `;
    expect(jobs[0]?.count).toBe(1);

    await expect(
      prisma.auditEvent.findFirst({
        where: {
          action: "hubspot_health.requested",
          entityType: "hubspot_health_check_run",
          entityId: payload.latestRun.id,
        },
      }),
    ).resolves.not.toBeNull();

    const pollResponse = await route.GET();
    expect(pollResponse.status).toBe(200);
    await expect(pollResponse.json()).resolves.toMatchObject({
      latestRun: { id: payload.latestRun.id, status: "queued" },
    });
  });
});
