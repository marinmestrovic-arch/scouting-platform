import { AdvancedReportRequestStatus as PrismaAdvancedReportRequestStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  ADVANCED_REPORT_FRESH_WINDOW_DAYS,
  isAdvancedReportFresh,
  resolveChannelAdvancedReportStatus,
} from "./status";

describe("advanced report status", () => {
  it("treats completed reports inside the freshness window as fresh", () => {
    const completedAt = new Date("2026-03-01T00:00:00.000Z");

    expect(
      isAdvancedReportFresh({
        request: {
          status: PrismaAdvancedReportRequestStatus.COMPLETED,
          completedAt,
        },
        now: new Date("2026-06-28T23:59:59.000Z"),
      }),
    ).toBe(true);
  });

  it("marks completed reports older than 120 days as stale", () => {
    const completedAt = new Date("2026-01-01T00:00:00.000Z");

    expect(
      resolveChannelAdvancedReportStatus({
        request: {
          status: PrismaAdvancedReportRequestStatus.COMPLETED,
          completedAt,
        },
        now: new Date(
          completedAt.getTime() + ADVANCED_REPORT_FRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        ),
      }),
    ).toBe("stale");
  });

  it("returns missing when no request exists", () => {
    expect(
      resolveChannelAdvancedReportStatus({
        request: null,
      }),
    ).toBe("missing");
  });
});
