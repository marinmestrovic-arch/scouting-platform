import { PrismaClient, Role } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CoreModule = typeof import("./index");

integration("week 2 core integration", () => {
  let prisma: PrismaClient;
  let core: CoreModule;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
    core = await import("./index");
  });

  beforeEach(async () => {
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

  it("supports create/list/update/delete for one user", async () => {
    const user = await prisma.user.create({
      data: {
        email: "owner@example.com",
        name: "Owner",
        role: Role.USER,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    const created = await core.createUserSegment({
      userId: user.id,
      name: "English creators",
      filters: {
        locale: "en",
        minSubscribers: 10000,
      },
    });

    expect(created.name).toBe("English creators");
    expect(created.filters).toMatchObject({
      locale: "en",
      minSubscribers: 10000,
    });

    const listed = await core.listUserSegments(user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const updated = await core.updateUserSegment({
      userId: user.id,
      segmentId: created.id,
      name: "US creators",
      filters: {
        locale: "en-US",
        minSubscribers: 20000,
      },
    });

    expect(updated.name).toBe("US creators");
    expect(updated.filters).toMatchObject({
      locale: "en-US",
      minSubscribers: 20000,
    });

    await core.deleteUserSegment({
      userId: user.id,
      segmentId: created.id,
    });

    const afterDelete = await core.listUserSegments(user.id);
    expect(afterDelete).toEqual([]);
  });

  it("enforces ownership isolation with not found behavior", async () => {
    const owner = await prisma.user.create({
      data: {
        email: "owner@example.com",
        name: "Owner",
        role: Role.USER,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    const otherUser = await prisma.user.create({
      data: {
        email: "other@example.com",
        name: "Other",
        role: Role.USER,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    const segment = await core.createUserSegment({
      userId: owner.id,
      name: "Owner segment",
      filters: {
        locale: "en",
      },
    });

    await expect(
      core.updateUserSegment({
        userId: otherUser.id,
        segmentId: segment.id,
        name: "Should fail",
        filters: {
          locale: "fr",
        },
      }),
    ).rejects.toMatchObject({
      code: "SEGMENT_NOT_FOUND",
      status: 404,
    });

    await expect(
      core.deleteUserSegment({
        userId: otherUser.id,
        segmentId: segment.id,
      }),
    ).rejects.toMatchObject({
      code: "SEGMENT_NOT_FOUND",
      status: 404,
    });
  });

  it("stores manual overrides, keeps them over automated upserts, and restores fallback on clear", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "admin@example.com",
        name: "Admin",
        role: Role.ADMIN,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    const created = await core.upsertChannelSkeleton({
      youtubeChannelId: "UC123",
      title: "Auto Title",
      handle: "@auto",
      description: "Auto Description",
      thumbnailUrl: "https://img.example.com/auto.png",
    });

    const patched = await core.patchChannelManualOverrides({
      channelId: created.id,
      actorUserId: admin.id,
      operations: [
        {
          field: "title",
          op: "set",
          value: "Manual Title",
        },
        {
          field: "description",
          op: "set",
          value: "Manual Description",
        },
      ],
    });

    expect(patched.channel.title).toBe("Manual Title");
    expect(patched.channel.description).toBe("Manual Description");

    await core.upsertChannelSkeleton({
      youtubeChannelId: "UC123",
      title: "Auto Title v2",
      handle: "@auto",
      description: "Auto Description v2",
      thumbnailUrl: "https://img.example.com/auto-v2.png",
    });

    const whileManual = await core.getChannelById(created.id);
    expect(whileManual?.title).toBe("Manual Title");
    expect(whileManual?.description).toBe("Manual Description");

    const cleared = await core.patchChannelManualOverrides({
      channelId: created.id,
      actorUserId: admin.id,
      operations: [
        {
          field: "title",
          op: "clear",
        },
        {
          field: "description",
          op: "clear",
        },
      ],
    });

    expect(cleared.channel.title).toBe("Auto Title v2");
    expect(cleared.channel.description).toBe("Auto Description v2");

    const remainingOverrides = await prisma.channelManualOverride.count({
      where: {
        channelId: created.id,
      },
    });
    expect(remainingOverrides).toBe(0);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: {
        action: "channel.manual_override.patched",
        entityId: created.id,
      },
    });
    expect(auditEvent).not.toBeNull();
  });

  it("returns not found when patching overrides for unknown channel", async () => {
    const admin = await prisma.user.create({
      data: {
        email: "admin@example.com",
        name: "Admin",
        role: Role.ADMIN,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    await expect(
      core.patchChannelManualOverrides({
        channelId: "1596b7c3-3a2a-4134-bd97-092de9991508",
        actorUserId: admin.id,
        operations: [
          {
            field: "title",
            op: "set",
            value: "Manual Title",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "CHANNEL_NOT_FOUND",
      status: 404,
    });
  });
});
