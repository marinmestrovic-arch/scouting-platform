import {
  AdvancedReportRequestStatus,
  ChannelEnrichmentStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type CoreModule = typeof import("./index");

integration("week 2 core integration", () => {
  let prisma: PrismaClient;
  let core: CoreModule;

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

  it("supports free-text search across title, handle, and youtube channel id", async () => {
    await core.upsertChannelSkeleton({
      youtubeChannelId: "UC_SPACE_ALPHA",
      title: "Orbital Mechanics",
      handle: "@orbitlab",
    });
    await core.upsertChannelSkeleton({
      youtubeChannelId: "UC_SPACE_BETA",
      title: "Launch Weekly",
      handle: "@launchpad",
    });

    const byTitle = await core.listChannels({
      page: 1,
      pageSize: 20,
      query: "orbital",
    });
    expect(byTitle.items.map((item) => item.youtubeChannelId)).toEqual(["UC_SPACE_ALPHA"]);

    const byHandle = await core.listChannels({
      page: 1,
      pageSize: 20,
      query: "launchpad",
    });
    expect(byHandle.items.map((item) => item.youtubeChannelId)).toEqual(["UC_SPACE_BETA"]);

    const byYoutubeId = await core.listChannels({
      page: 1,
      pageSize: 20,
      query: "space_alpha",
    });
    expect(byYoutubeId.items.map((item) => item.youtubeChannelId)).toEqual(["UC_SPACE_ALPHA"]);
  });

  it("filters channel list by resolved enrichment status including stale", async () => {
    const requester = await prisma.user.create({
      data: {
        email: "requester@example.com",
        name: "Requester",
        role: Role.USER,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    const staleChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_STALE",
        title: "Stale enrichment",
      },
      select: {
        id: true,
      },
    });
    const readyChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_READY",
        title: "Ready enrichment",
      },
      select: {
        id: true,
      },
    });
    const failedChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_FAILED",
        title: "Failed enrichment",
      },
      select: {
        id: true,
      },
    });

    await prisma.channelEnrichment.create({
      data: {
        channelId: staleChannel.id,
        status: ChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: requester.id,
        requestedAt: new Date("2026-02-01T10:00:00.000Z"),
        completedAt: new Date("2026-02-01T10:00:00.000Z"),
      },
    });
    const readyEnrichmentCompletedAt = new Date();
    const readyChannelUpdatedAt = new Date(readyEnrichmentCompletedAt.getTime() - 24 * 60 * 60 * 1000);
    await prisma.channelEnrichment.create({
      data: {
        channelId: readyChannel.id,
        status: ChannelEnrichmentStatus.COMPLETED,
        requestedByUserId: requester.id,
        requestedAt: readyEnrichmentCompletedAt,
        completedAt: readyEnrichmentCompletedAt,
      },
    });
    await prisma.$executeRaw`
      UPDATE channels
      SET updated_at = ${readyChannelUpdatedAt}
      WHERE id = ${readyChannel.id}::uuid
    `;
    await prisma.channelEnrichment.create({
      data: {
        channelId: failedChannel.id,
        status: ChannelEnrichmentStatus.FAILED,
        requestedByUserId: requester.id,
        requestedAt: new Date("2026-03-09T10:00:00.000Z"),
        lastError: "quota",
      },
    });

    const staleOnly = await core.listChannels({
      page: 1,
      pageSize: 20,
      enrichmentStatus: ["stale"],
    });
    expect(staleOnly.items.map((item) => item.youtubeChannelId)).toEqual(["UC_STALE"]);

    const staleOrFailed = await core.listChannels({
      page: 1,
      pageSize: 20,
      enrichmentStatus: ["stale", "failed"],
    });
    expect(staleOrFailed.items.map((item) => item.youtubeChannelId)).toEqual([
      "UC_FAILED",
      "UC_STALE",
    ]);
  });

  it("filters channel list by latest advanced report status and supports combined filters", async () => {
    const requester = await prisma.user.create({
      data: {
        email: "approvals@example.com",
        name: "Approvals",
        role: Role.USER,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    const pendingChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_PENDING",
        title: "Pending report",
      },
      select: {
        id: true,
      },
    });
    const staleReportChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_REPORT_STALE",
        title: "Stale report",
      },
      select: {
        id: true,
      },
    });
    const combinedChannel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_COMBINED",
        title: "Combined filter channel",
      },
      select: {
        id: true,
      },
    });

    await prisma.advancedReportRequest.create({
      data: {
        channelId: pendingChannel.id,
        requestedByUserId: requester.id,
        status: AdvancedReportRequestStatus.PENDING_APPROVAL,
      },
    });
    await prisma.advancedReportRequest.create({
      data: {
        channelId: staleReportChannel.id,
        requestedByUserId: requester.id,
        status: AdvancedReportRequestStatus.COMPLETED,
        completedAt: new Date("2025-09-01T12:00:00.000Z"),
      },
    });
    const combinedCompletedRequest = await prisma.advancedReportRequest.create({
      data: {
        channelId: combinedChannel.id,
        requestedByUserId: requester.id,
        status: AdvancedReportRequestStatus.COMPLETED,
        completedAt: new Date("2026-03-08T12:00:00.000Z"),
      },
      select: {
        id: true,
      },
    });
    const combinedFailedRequest = await prisma.advancedReportRequest.create({
      data: {
        channelId: combinedChannel.id,
        requestedByUserId: requester.id,
        status: AdvancedReportRequestStatus.FAILED,
        lastError: "provider timeout",
      },
      select: {
        id: true,
      },
    });
    await prisma.$executeRaw`
      UPDATE advanced_report_requests
      SET created_at = ${new Date("2026-03-08T12:00:00.000Z")},
          updated_at = ${new Date("2026-03-08T12:00:00.000Z")}
      WHERE id = ${combinedCompletedRequest.id}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE advanced_report_requests
      SET created_at = ${new Date("2026-03-09T12:00:00.000Z")},
          updated_at = ${new Date("2026-03-09T12:00:00.000Z")}
      WHERE id = ${combinedFailedRequest.id}::uuid
    `;
    await prisma.channelEnrichment.create({
      data: {
        channelId: combinedChannel.id,
        status: ChannelEnrichmentStatus.FAILED,
        requestedByUserId: requester.id,
        requestedAt: new Date("2026-03-09T10:00:00.000Z"),
        lastError: "quota",
      },
    });

    const pendingOnly = await core.listChannels({
      page: 1,
      pageSize: 20,
      advancedReportStatus: ["pending_approval"],
    });
    expect(pendingOnly.items.map((item) => item.youtubeChannelId)).toEqual(["UC_PENDING"]);

    const staleOnly = await core.listChannels({
      page: 1,
      pageSize: 20,
      advancedReportStatus: ["stale"],
    });
    expect(staleOnly.items.map((item) => item.youtubeChannelId)).toEqual(["UC_REPORT_STALE"]);

    const combined = await core.listChannels({
      page: 1,
      pageSize: 20,
      query: "combined",
      enrichmentStatus: ["failed"],
      advancedReportStatus: ["failed"],
    });
    expect(combined.items.map((item) => item.youtubeChannelId)).toEqual(["UC_COMBINED"]);
  });

  it("paginates resolved status filters without loading unrelated pages into the result", async () => {
    const requester = await prisma.user.create({
      data: {
        email: "pagination@example.com",
        name: "Pagination",
        role: Role.USER,
        passwordHash: "bootstrap-hash",
        isActive: true,
      },
    });

    const newest = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_FAILED_NEWEST",
        title: "Newest failed channel",
      },
    });
    const middle = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_FAILED_MIDDLE",
        title: "Middle failed channel",
      },
    });
    const oldest = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC_FAILED_OLDEST",
        title: "Oldest failed channel",
      },
    });

    await prisma.channelEnrichment.createMany({
      data: [
        {
          channelId: newest.id,
          status: ChannelEnrichmentStatus.FAILED,
          requestedByUserId: requester.id,
          requestedAt: new Date("2026-03-11T12:00:00.000Z"),
          lastError: "quota",
        },
        {
          channelId: middle.id,
          status: ChannelEnrichmentStatus.FAILED,
          requestedByUserId: requester.id,
          requestedAt: new Date("2026-03-10T12:00:00.000Z"),
          lastError: "quota",
        },
        {
          channelId: oldest.id,
          status: ChannelEnrichmentStatus.FAILED,
          requestedByUserId: requester.id,
          requestedAt: new Date("2026-03-09T12:00:00.000Z"),
          lastError: "quota",
        },
      ],
    });

    await prisma.$executeRaw`
      UPDATE channels
      SET created_at = ${new Date("2026-03-11T12:00:00.000Z")}
      WHERE id = ${newest.id}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE channels
      SET created_at = ${new Date("2026-03-10T12:00:00.000Z")}
      WHERE id = ${middle.id}::uuid
    `;
    await prisma.$executeRaw`
      UPDATE channels
      SET created_at = ${new Date("2026-03-09T12:00:00.000Z")}
      WHERE id = ${oldest.id}::uuid
    `;

    const firstPage = await core.listChannels({
      page: 1,
      pageSize: 2,
      enrichmentStatus: ["failed"],
    });
    const secondPage = await core.listChannels({
      page: 2,
      pageSize: 2,
      enrichmentStatus: ["failed"],
    });

    expect(firstPage.total).toBe(3);
    expect(firstPage.items.map((item) => item.youtubeChannelId)).toEqual([
      "UC_FAILED_NEWEST",
      "UC_FAILED_MIDDLE",
    ]);
    expect(secondPage.total).toBe(3);
    expect(secondPage.items.map((item) => item.youtubeChannelId)).toEqual([
      "UC_FAILED_OLDEST",
    ]);
  });
});
