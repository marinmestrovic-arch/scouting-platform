import { describe, expect, it } from "vitest";

import { parseJobPayload } from "./jobs";

const TEST_UUID = "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b";

describe("parseJobPayload", () => {
  it("parses a valid runs.discover payload", () => {
    const payload = parseJobPayload("runs.discover", {
      runRequestId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });

    expect(payload).toEqual({
      runRequestId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });
  });

  it("rejects payloads missing required fields", () => {
    expect(() =>
      parseJobPayload("channels.enrich.llm", {
        requestedByUserId: TEST_UUID,
      }),
    ).toThrow();
  });

  it("parses maintenance payload for system jobs", () => {
    const payload = parseJobPayload("maintenance.refresh-stale", {
      initiatedBy: "system",
    });

    expect(payload).toEqual({
      initiatedBy: "system",
    });
  });

  it("parses a valid channels.enrich.hypeauditor payload", () => {
    const payload = parseJobPayload("channels.enrich.hypeauditor", {
      advancedReportRequestId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });

    expect(payload).toEqual({
      advancedReportRequestId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });
  });
});
