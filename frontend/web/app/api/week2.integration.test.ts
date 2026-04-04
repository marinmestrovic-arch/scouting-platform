import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("week 2 API integration", () => {
  let prisma: PrismaClient;
  let segmentsRoute: typeof import("./segments/route");
  let segmentDetailRoute: typeof import("./segments/[id]/route");
  let adminChannelManualOverridesRoute: typeof import("./admin/channels/[id]/manual-overrides/route");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week2-integration-auth-secret";

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
    segmentsRoute = await import("./segments/route");
    segmentDetailRoute = await import("./segments/[id]/route");
    adminChannelManualOverridesRoute = await import(
      "./admin/channels/[id]/manual-overrides/route"
    );
  });

  beforeEach(async () => {
    currentSessionUser = null;
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        channel_manual_overrides,
        saved_segments,
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
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createUser(email: string): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email,
        name: "User",
        role: Role.USER,
        passwordHash: "user-hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  async function createAdminUser(email: string): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email,
        name: "Admin",
        role: Role.ADMIN,
        passwordHash: "admin-hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  it("returns 401 for unauthenticated segment routes", async () => {
    const listResponse = await segmentsRoute.GET();
    expect(listResponse.status).toBe(401);

    const deleteResponse = await segmentDetailRoute.DELETE(
      new Request("http://localhost/api/segments/any"),
      { params: Promise.resolve({ id: "2b97ca47-a0f0-44a2-bf11-d6f0eb20f998" }) },
    );
    expect(deleteResponse.status).toBe(401);
  });

  it("returns 400 for invalid payload and invalid params", async () => {
    const user = await createUser("user@example.com");
    currentSessionUser = { id: user.id, role: "user" };

    const invalidPayloadResponse = await segmentsRoute.POST(
      new Request("http://localhost/api/segments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "",
          filters: {
            channelIds: ["abc123"],
          },
        }),
      }),
    );

    expect(invalidPayloadResponse.status).toBe(400);

    const invalidParamResponse = await segmentDetailRoute.PUT(
      new Request("http://localhost/api/segments/not-a-uuid", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Segment",
          filters: {
            locale: "en",
          },
        }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(invalidParamResponse.status).toBe(400);
  });

  it("supports segment create/list/update/delete for authenticated user", async () => {
    const user = await createUser("user@example.com");
    currentSessionUser = { id: user.id, role: "user" };

    const createResponse = await segmentsRoute.POST(
      new Request("http://localhost/api/segments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "English creators",
          filters: {
            locale: "en",
            minSubscribers: 10000,
          },
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.name).toBe("English creators");

    const listResponse = await segmentsRoute.GET();
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.items).toHaveLength(1);
    expect(listPayload.items[0]?.id).toBe(created.id);

    const updateResponse = await segmentDetailRoute.PUT(
      new Request(`http://localhost/api/segments/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "US creators",
          filters: {
            locale: "en-US",
          },
        }),
      }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(updateResponse.status).toBe(200);
    const updated = await updateResponse.json();
    expect(updated.name).toBe("US creators");

    const deleteResponse = await segmentDetailRoute.DELETE(
      new Request(`http://localhost/api/segments/${created.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: created.id }) },
    );

    expect(deleteResponse.status).toBe(204);

    const listAfterDelete = await segmentsRoute.GET();
    expect(listAfterDelete.status).toBe(200);
    const listAfterDeletePayload = await listAfterDelete.json();
    expect(listAfterDeletePayload.items).toEqual([]);
  });

  it("returns 404 for non-owned segment updates and deletes", async () => {
    const owner = await createUser("owner@example.com");
    const otherUser = await createUser("other@example.com");
    const segment = await prisma.savedSegment.create({
      data: {
        userId: owner.id,
        name: "Owner segment",
        filters: {
          locale: "en",
        },
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = { id: otherUser.id, role: "user" };

    const updateResponse = await segmentDetailRoute.PUT(
      new Request(`http://localhost/api/segments/${segment.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Should not update",
          filters: {
            locale: "fr",
          },
        }),
      }),
      { params: Promise.resolve({ id: segment.id }) },
    );
    expect(updateResponse.status).toBe(404);

    const deleteResponse = await segmentDetailRoute.DELETE(
      new Request(`http://localhost/api/segments/${segment.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: segment.id }) },
    );
    expect(deleteResponse.status).toBe(404);
  });

  it("enforces admin-only access on channel manual override route", async () => {
    const user = await createUser("user@example.com");
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-ADMIN-GUARD",
        title: "Title",
      },
      select: {
        id: true,
      },
    });

    currentSessionUser = null;
    const unauthenticated = await adminChannelManualOverridesRoute.PATCH(
      new Request(`http://localhost/api/admin/channels/${channel.id}/manual-overrides`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operations: [{ field: "title", op: "set", value: "Manual" }],
        }),
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );
    expect(unauthenticated.status).toBe(401);

    currentSessionUser = { id: user.id, role: "user" };
    const forbidden = await adminChannelManualOverridesRoute.PATCH(
      new Request(`http://localhost/api/admin/channels/${channel.id}/manual-overrides`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operations: [{ field: "title", op: "set", value: "Manual" }],
        }),
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );
    expect(forbidden.status).toBe(403);
  });

  it("patches manual overrides, applies set/clear semantics, and records audit event", async () => {
    const admin = await createAdminUser("admin@example.com");
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-MANUAL-1",
        title: "Auto Title",
        description: "Auto Description",
      },
    });

    currentSessionUser = { id: admin.id, role: "admin" };

    const setResponse = await adminChannelManualOverridesRoute.PATCH(
      new Request(`http://localhost/api/admin/channels/${channel.id}/manual-overrides`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operations: [
            { field: "title", op: "set", value: "Manual Title" },
            { field: "description", op: "set", value: "Manual Description" },
          ],
        }),
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );

    expect(setResponse.status).toBe(200);
    const setPayload = await setResponse.json();
    expect(setPayload.channel.title).toBe("Manual Title");
    expect(setPayload.channel.description).toBe("Manual Description");

    const clearResponse = await adminChannelManualOverridesRoute.PATCH(
      new Request(`http://localhost/api/admin/channels/${channel.id}/manual-overrides`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operations: [
            { field: "title", op: "clear" },
            { field: "description", op: "clear" },
          ],
        }),
      }),
      { params: Promise.resolve({ id: channel.id }) },
    );

    expect(clearResponse.status).toBe(200);
    const clearPayload = await clearResponse.json();
    expect(clearPayload.channel.title).toBe("Auto Title");
    expect(clearPayload.channel.description).toBe("Auto Description");

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        action: "channel.manual_override.patched",
        entityId: channel.id,
      },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("returns 400/404 for invalid channel override patch requests", async () => {
    const admin = await createAdminUser("admin@example.com");
    currentSessionUser = { id: admin.id, role: "admin" };

    const invalidParamResponse = await adminChannelManualOverridesRoute.PATCH(
      new Request("http://localhost/api/admin/channels/not-a-uuid/manual-overrides", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operations: [{ field: "title", op: "set", value: "Manual Title" }],
        }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(invalidParamResponse.status).toBe(400);

    const invalidPayloadResponse = await adminChannelManualOverridesRoute.PATCH(
      new Request("http://localhost/api/admin/channels/95fe0cf0-f8bc-4edf-b9c3-007ac5973e37/manual-overrides", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operations: [
            { field: "title", op: "set", value: "Manual Title" },
            { field: "title", op: "clear" },
          ],
        }),
      }),
      { params: Promise.resolve({ id: "95fe0cf0-f8bc-4edf-b9c3-007ac5973e37" }) },
    );
    expect(invalidPayloadResponse.status).toBe(400);

    const missingChannelResponse = await adminChannelManualOverridesRoute.PATCH(
      new Request("http://localhost/api/admin/channels/95fe0cf0-f8bc-4edf-b9c3-007ac5973e37/manual-overrides", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operations: [{ field: "title", op: "set", value: "Manual Title" }],
        }),
      }),
      { params: Promise.resolve({ id: "95fe0cf0-f8bc-4edf-b9c3-007ac5973e37" }) },
    );
    expect(missingChannelResponse.status).toBe(404);
  });
});
