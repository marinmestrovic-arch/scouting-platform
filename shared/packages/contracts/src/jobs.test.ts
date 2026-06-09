import { describe, expect, it } from "vitest";

import { parseJobPayload, runsAssessChannelFitPayloadSchema } from "./jobs";

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

  it("parses legacy and scoped channel enrichment payloads", () => {
    expect(
      parseJobPayload("channels.enrich.llm", {
        channelId: TEST_UUID,
        requestedByUserId: TEST_UUID,
      }),
    ).toEqual({
      channelId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });

    expect(
      parseJobPayload("channels.enrich.llm", {
        channelId: TEST_UUID,
        requestedByUserId: TEST_UUID,
        mode: "youtube_only",
      }),
    ).toEqual({
      channelId: TEST_UUID,
      requestedByUserId: TEST_UUID,
      mode: "youtube_only",
    });
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

  it("parses a valid runs.assess.channel-fit payload", () => {
    const payload = runsAssessChannelFitPayloadSchema.parse({
      runRequestId: TEST_UUID,
      channelId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });

    expect(payload).toEqual({
      runRequestId: TEST_UUID,
      channelId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });
  });

  it("parses job payloads for runs.assess.channel-fit", () => {
    const payload = parseJobPayload("runs.assess.channel-fit", {
      runRequestId: TEST_UUID,
      channelId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });

    expect(payload).toEqual({
      runRequestId: TEST_UUID,
      channelId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });
  });

  it("parses a valid hubspot.object-sync payload", () => {
    const payload = parseJobPayload("hubspot.object-sync", {
      syncRunId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });

    expect(payload).toEqual({
      syncRunId: TEST_UUID,
      requestedByUserId: TEST_UUID,
    });
  });

  it("rejects runs.assess.channel-fit payloads missing runRequestId", () => {
    expect(() =>
      parseJobPayload("runs.assess.channel-fit", {
        channelId: TEST_UUID,
        requestedByUserId: TEST_UUID,
      }),
    ).toThrow();
  });
});
