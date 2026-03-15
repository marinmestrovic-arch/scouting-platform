import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createCsvExportBatchMock,
  createHubspotPushBatchMock,
  fetchRunStatusMock,
} = vi.hoisted(() => ({
  createCsvExportBatchMock: vi.fn(),
  createHubspotPushBatchMock: vi.fn(),
  fetchRunStatusMock: vi.fn(),
}));

vi.mock("./csv-export-batches-api", () => ({
  createCsvExportBatch: createCsvExportBatchMock,
}));

vi.mock("./hubspot-push-batches-api", () => ({
  createHubspotPushBatch: createHubspotPushBatchMock,
}));

vi.mock("./runs-api", () => ({
  fetchRunStatus: fetchRunStatusMock,
}));

import {
  createCsvExportBatchFromRun,
  createHubspotPushBatchFromRun,
  getRunResultChannelIds,
  RunBatchActionError,
} from "./run-batch-actions";

describe("run batch actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deduplicates channel ids from run results", () => {
    expect(
      getRunResultChannelIds({
        results: [
          { channelId: "channel-1" },
          { channelId: "channel-2" },
          { channelId: "channel-1" },
        ],
      } as never),
    ).toEqual(["channel-1", "channel-2"]);
  });

  it("creates a selected CSV export batch from a run", async () => {
    fetchRunStatusMock.mockResolvedValueOnce({
      results: [
        { channelId: "channel-1" },
        { channelId: "channel-2" },
        { channelId: "channel-1" },
      ],
    });
    createCsvExportBatchMock.mockResolvedValueOnce({ id: "batch-1" });

    const result = await createCsvExportBatchFromRun("run-1");

    expect(fetchRunStatusMock).toHaveBeenCalledWith("run-1");
    expect(createCsvExportBatchMock).toHaveBeenCalledWith({
      type: "selected",
      channelIds: ["channel-1", "channel-2"],
    });
    expect(result).toEqual({ id: "batch-1" });
  });

  it("creates a HubSpot push batch from a run", async () => {
    fetchRunStatusMock.mockResolvedValueOnce({
      results: [{ channelId: "channel-9" }],
    });
    createHubspotPushBatchMock.mockResolvedValueOnce({ id: "hubspot-1" });

    const result = await createHubspotPushBatchFromRun("run-9");

    expect(fetchRunStatusMock).toHaveBeenCalledWith("run-9");
    expect(createHubspotPushBatchMock).toHaveBeenCalledWith({
      channelIds: ["channel-9"],
    });
    expect(result).toEqual({ id: "hubspot-1" });
  });

  it("fails clearly when a run has no stored results yet", async () => {
    fetchRunStatusMock.mockResolvedValueOnce({
      results: [],
    });

    await expect(createCsvExportBatchFromRun("run-empty")).rejects.toBeInstanceOf(
      RunBatchActionError,
    );
    expect(createCsvExportBatchMock).not.toHaveBeenCalled();
  });
});
