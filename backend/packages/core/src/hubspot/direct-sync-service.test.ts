import {
  HubspotImportBatchStatus as PrismaHubspotImportBatchStatus,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  getHubspotDirectSyncPhase,
  isHubspotPartialFailureRetryable,
} from "./direct-sync-service";

describe("HubSpot direct sync state rules", () => {
  it("maps persisted statuses to one bounded worker phase", () => {
    expect(getHubspotDirectSyncPhase(PrismaHubspotImportBatchStatus.QUEUED)).toBe("prepare");
    expect(getHubspotDirectSyncPhase(PrismaHubspotImportBatchStatus.PREPARING)).toBe("prepare");
    expect(getHubspotDirectSyncPhase(PrismaHubspotImportBatchStatus.SUBMITTING)).toBe("submit");
    expect(getHubspotDirectSyncPhase(PrismaHubspotImportBatchStatus.SUBMITTED)).toBe("submit");
    expect(getHubspotDirectSyncPhase(PrismaHubspotImportBatchStatus.PROCESSING)).toBe("associate");
    expect(getHubspotDirectSyncPhase(PrismaHubspotImportBatchStatus.COMPLETED)).toBe("terminal");
    expect(
      getHubspotDirectSyncPhase(PrismaHubspotImportBatchStatus.COMPLETED_WITH_ERRORS),
    ).toBe("terminal");
    expect(getHubspotDirectSyncPhase(PrismaHubspotImportBatchStatus.FAILED)).toBe("terminal");
  });

  it("retries only transient partial failures", () => {
    expect(
      isHubspotPartialFailureRetryable({
        inputIndex: 0,
        objectWriteTraceId: "row-1",
        success: false,
        category: "RATE_LIMIT",
        code: "TOO_MANY_REQUESTS",
        message: "try later",
      }),
    ).toBe(true);
    expect(
      isHubspotPartialFailureRetryable({
        inputIndex: 0,
        objectWriteTraceId: "row-1",
        success: false,
        category: "VALIDATION_ERROR",
        code: "PROPERTY_DOESNT_EXIST",
        message: "fix schema",
      }),
    ).toBe(false);
  });
});
