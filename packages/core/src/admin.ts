import {
  AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus,
  CredentialProvider,
  CsvImportBatchStatus as PrismaCsvImportBatchStatus,
  Role as PrismaRole,
  type Prisma,
} from "@prisma/client";
import type {
  AdminAdvancedReportRequestSummary,
  AdminDashboardResponse,
  AdminUserResponse,
  CsvImportBatchSummary,
  LatestCompletedAdvancedReport,
} from "@scouting-platform/contracts";
import { prisma } from "@scouting-platform/db";

import { toAdvancedReportRequestStatus, toLatestCompletedAdvancedReport } from "./approvals/status";

const adminDashboardApprovalPreviewSelect = {
  id: true,
  status: true,
  decisionNote: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  reviewedAt: true,
  startedAt: true,
  completedAt: true,
  channel: {
    select: {
      id: true,
      youtubeChannelId: true,
      title: true,
    },
  },
  requestedByUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
  reviewedByUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} as const;

const adminDashboardImportPreviewSelect = {
  id: true,
  fileName: true,
  templateVersion: true,
  status: true,
  totalRowCount: true,
  importedRowCount: true,
  failedRowCount: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  completedAt: true,
  requestedByUser: {
    select: {
      id: true,
      email: true,
      name: true,
    },
  },
} as const;

const adminDashboardMissingKeyUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ApprovalPreviewRecord = Prisma.AdvancedReportRequestGetPayload<{
  select: typeof adminDashboardApprovalPreviewSelect;
}>;

type ImportPreviewRecord = Prisma.CsvImportBatchGetPayload<{
  select: typeof adminDashboardImportPreviewSelect;
}>;

type MissingKeyUserRecord = Prisma.UserGetPayload<{
  select: typeof adminDashboardMissingKeyUserSelect;
}>;

function toCsvImportBatchStatus(status: PrismaCsvImportBatchStatus): CsvImportBatchSummary["status"] {
  switch (status) {
    case PrismaCsvImportBatchStatus.RUNNING:
      return "running";
    case PrismaCsvImportBatchStatus.COMPLETED:
      return "completed";
    case PrismaCsvImportBatchStatus.FAILED:
      return "failed";
    default:
      return "queued";
  }
}

function toAdminUserResponse(user: MissingKeyUserRecord): AdminUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === PrismaRole.ADMIN ? "admin" : "user",
    isActive: user.isActive,
    youtubeKeyAssigned: false,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function toCsvImportBatchSummary(batch: ImportPreviewRecord): CsvImportBatchSummary {
  return {
    id: batch.id,
    fileName: batch.fileName,
    templateVersion: batch.templateVersion,
    status: toCsvImportBatchStatus(batch.status),
    totalRowCount: batch.totalRowCount,
    importedRowCount: batch.importedRowCount,
    failedRowCount: batch.failedRowCount,
    lastError: batch.lastError,
    requestedBy: {
      id: batch.requestedByUser.id,
      email: batch.requestedByUser.email,
      name: batch.requestedByUser.name,
    },
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    startedAt: batch.startedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
  };
}

function toAdminAdvancedReportRequestSummary(
  request: ApprovalPreviewRecord,
  lastCompletedReport: LatestCompletedAdvancedReport | null,
): AdminAdvancedReportRequestSummary {
  return {
    id: request.id,
    channel: {
      id: request.channel.id,
      youtubeChannelId: request.channel.youtubeChannelId,
      title: request.channel.title,
    },
    requestedBy: {
      id: request.requestedByUser.id,
      email: request.requestedByUser.email,
      name: request.requestedByUser.name,
    },
    reviewedBy: request.reviewedByUser
      ? {
          id: request.reviewedByUser.id,
          email: request.reviewedByUser.email,
          name: request.reviewedByUser.name,
        }
      : null,
    status: toAdvancedReportRequestStatus(request.status),
    decisionNote: request.decisionNote,
    lastError: request.lastError,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    startedAt: request.startedAt?.toISOString() ?? null,
    completedAt: request.completedAt?.toISOString() ?? null,
    lastCompletedReport,
  };
}

function getApprovalCount(
  counts: Map<PrismaAdvancedReportRequestStatus, number>,
  status: PrismaAdvancedReportRequestStatus,
): number {
  return counts.get(status) ?? 0;
}

function getImportCount(
  counts: Map<PrismaCsvImportBatchStatus, number>,
  status: PrismaCsvImportBatchStatus,
): number {
  return counts.get(status) ?? 0;
}

async function getLatestCompletedReportsByChannelIds(
  channelIds: string[],
  now: Date,
): Promise<Map<string, LatestCompletedAdvancedReport>> {
  if (channelIds.length === 0) {
    return new Map();
  }

  const requests = await prisma.advancedReportRequest.findMany({
    where: {
      channelId: {
        in: channelIds,
      },
      status: PrismaAdvancedReportRequestStatus.COMPLETED,
      completedAt: {
        not: null,
      },
    },
    orderBy: [
      {
        completedAt: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
    select: {
      id: true,
      channelId: true,
      completedAt: true,
    },
  });

  const reportsByChannelId = new Map<string, LatestCompletedAdvancedReport>();

  for (const request of requests) {
    if (reportsByChannelId.has(request.channelId)) {
      continue;
    }

    const report = toLatestCompletedAdvancedReport({
      request: {
        id: request.id,
        completedAt: request.completedAt,
      },
      now,
    });

    if (report) {
      reportsByChannelId.set(request.channelId, report);
    }
  }

  return reportsByChannelId;
}

export async function getAdminDashboardSummary(): Promise<AdminDashboardResponse> {
  const generatedAt = new Date();

  const [
    approvalGroups,
    pendingPreviewRecords,
    importGroups,
    importAttentionRecords,
    totalCount,
    activeCount,
    adminCount,
    missingYoutubeKeyCount,
    missingYoutubeKeyPreviewRecords,
  ] = await Promise.all([
    prisma.advancedReportRequest.groupBy({
      by: ["status"],
      _count: {
        _all: true,
      },
    }),
    prisma.advancedReportRequest.findMany({
      where: {
        status: PrismaAdvancedReportRequestStatus.PENDING_APPROVAL,
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 5,
      select: adminDashboardApprovalPreviewSelect,
    }),
    prisma.csvImportBatch.groupBy({
      by: ["status"],
      _count: {
        _all: true,
      },
    }),
    prisma.csvImportBatch.findMany({
      where: {
        status: {
          in: [
            PrismaCsvImportBatchStatus.QUEUED,
            PrismaCsvImportBatchStatus.RUNNING,
            PrismaCsvImportBatchStatus.FAILED,
          ],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
      select: adminDashboardImportPreviewSelect,
    }),
    prisma.user.count(),
    prisma.user.count({
      where: {
        isActive: true,
      },
    }),
    prisma.user.count({
      where: {
        role: PrismaRole.ADMIN,
      },
    }),
    prisma.user.count({
      where: {
        isActive: true,
        role: PrismaRole.USER,
        credentials: {
          none: {
            provider: CredentialProvider.YOUTUBE_DATA_API,
          },
        },
      },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
        role: PrismaRole.USER,
        credentials: {
          none: {
            provider: CredentialProvider.YOUTUBE_DATA_API,
          },
        },
      },
      orderBy: {
        createdAt: "asc",
      },
      take: 5,
      select: adminDashboardMissingKeyUserSelect,
    }),
  ]);

  const latestCompletedReportsByChannelId = await getLatestCompletedReportsByChannelIds(
    [...new Set(pendingPreviewRecords.map((request) => request.channel.id))],
    generatedAt,
  );

  const approvalCounts = new Map(
    approvalGroups.map((group) => [group.status, group._count._all] as const),
  );
  const importCounts = new Map(
    importGroups.map((group) => [group.status, group._count._all] as const),
  );

  return {
    generatedAt: generatedAt.toISOString(),
    approvals: {
      counts: {
        pendingApproval: getApprovalCount(
          approvalCounts,
          PrismaAdvancedReportRequestStatus.PENDING_APPROVAL,
        ),
        approved: getApprovalCount(approvalCounts, PrismaAdvancedReportRequestStatus.APPROVED),
        queued: getApprovalCount(approvalCounts, PrismaAdvancedReportRequestStatus.QUEUED),
        running: getApprovalCount(approvalCounts, PrismaAdvancedReportRequestStatus.RUNNING),
        failed: getApprovalCount(approvalCounts, PrismaAdvancedReportRequestStatus.FAILED),
      },
      pendingPreview: pendingPreviewRecords.map((request) =>
        toAdminAdvancedReportRequestSummary(
          request,
          latestCompletedReportsByChannelId.get(request.channel.id) ?? null,
        ),
      ),
    },
    imports: {
      counts: {
        queued: getImportCount(importCounts, PrismaCsvImportBatchStatus.QUEUED),
        running: getImportCount(importCounts, PrismaCsvImportBatchStatus.RUNNING),
        failed: getImportCount(importCounts, PrismaCsvImportBatchStatus.FAILED),
      },
      attentionPreview: importAttentionRecords.map(toCsvImportBatchSummary),
    },
    users: {
      totalCount,
      activeCount,
      adminCount,
      missingYoutubeKeyCount,
      missingYoutubeKeyPreview: missingYoutubeKeyPreviewRecords.map(toAdminUserResponse),
    },
  };
}
