import { AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus } from "@prisma/client";
import type {
  AdvancedReportRequestStatus,
  ChannelAdvancedReportStatus,
  LatestCompletedAdvancedReport,
} from "@scouting-platform/contracts";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const ADVANCED_REPORT_FRESH_WINDOW_DAYS = 120;

type AdvancedReportStatusSource = {
  status: PrismaAdvancedReportRequestStatus;
  completedAt: Date | null;
};

type CompletedAdvancedReportSource = {
  id: string;
  completedAt: Date | null;
};

export function toAdvancedReportRequestStatus(
  status: PrismaAdvancedReportRequestStatus,
): AdvancedReportRequestStatus {
  switch (status) {
    case PrismaAdvancedReportRequestStatus.PENDING_APPROVAL:
      return "pending_approval";
    case PrismaAdvancedReportRequestStatus.APPROVED:
      return "approved";
    case PrismaAdvancedReportRequestStatus.REJECTED:
      return "rejected";
    case PrismaAdvancedReportRequestStatus.QUEUED:
      return "queued";
    case PrismaAdvancedReportRequestStatus.RUNNING:
      return "running";
    case PrismaAdvancedReportRequestStatus.COMPLETED:
      return "completed";
    case PrismaAdvancedReportRequestStatus.FAILED:
      return "failed";
  }
}

export function fromAdvancedReportRequestStatus(
  status: AdvancedReportRequestStatus,
): PrismaAdvancedReportRequestStatus {
  switch (status) {
    case "pending_approval":
      return PrismaAdvancedReportRequestStatus.PENDING_APPROVAL;
    case "approved":
      return PrismaAdvancedReportRequestStatus.APPROVED;
    case "rejected":
      return PrismaAdvancedReportRequestStatus.REJECTED;
    case "queued":
      return PrismaAdvancedReportRequestStatus.QUEUED;
    case "running":
      return PrismaAdvancedReportRequestStatus.RUNNING;
    case "completed":
      return PrismaAdvancedReportRequestStatus.COMPLETED;
    case "failed":
      return PrismaAdvancedReportRequestStatus.FAILED;
  }
}

export function isAdvancedReportFresh(input: {
  request: AdvancedReportStatusSource;
  now?: Date;
}): boolean {
  if (input.request.status !== PrismaAdvancedReportRequestStatus.COMPLETED) {
    return false;
  }

  if (!input.request.completedAt) {
    return false;
  }

  const now = input.now ?? new Date();

  return (
    now.getTime() - input.request.completedAt.getTime() <
    ADVANCED_REPORT_FRESH_WINDOW_DAYS * DAY_IN_MS
  );
}

export function getAdvancedReportAgeDays(input: {
  completedAt: Date;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const ageInMs = Math.max(0, now.getTime() - input.completedAt.getTime());

  return Math.floor(ageInMs / DAY_IN_MS);
}

export function toLatestCompletedAdvancedReport(input: {
  request: CompletedAdvancedReportSource | null;
  now?: Date;
}): LatestCompletedAdvancedReport | null {
  if (!input.request?.completedAt) {
    return null;
  }

  return {
    requestId: input.request.id,
    completedAt: input.request.completedAt.toISOString(),
    ageDays: getAdvancedReportAgeDays({
      completedAt: input.request.completedAt,
      ...(input.now ? { now: input.now } : {}),
    }),
    withinFreshWindow: isAdvancedReportFresh({
      request: {
        status: PrismaAdvancedReportRequestStatus.COMPLETED,
        completedAt: input.request.completedAt,
      },
      ...(input.now ? { now: input.now } : {}),
    }),
  };
}

export function resolveChannelAdvancedReportStatus(input: {
  request: AdvancedReportStatusSource | null;
  now?: Date;
}): ChannelAdvancedReportStatus {
  if (!input.request) {
    return "missing";
  }

  if (
    input.request.status === PrismaAdvancedReportRequestStatus.COMPLETED &&
    !isAdvancedReportFresh({
      request: input.request,
      ...(input.now ? { now: input.now } : {}),
    })
  ) {
    return "stale";
  }

  return toAdvancedReportRequestStatus(input.request.status);
}
