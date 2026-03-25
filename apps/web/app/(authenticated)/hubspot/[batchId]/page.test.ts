import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hubspotPushBatchResultShellMock } = vi.hoisted(() => ({
  hubspotPushBatchResultShellMock: vi.fn(({ batchId }: { batchId: string }) => `hubspot-push-batch-result-shell:${batchId}`),
}));

vi.mock("../../../../components/hubspot/hubspot-push-batch-result-shell", () => ({
  HubspotPushBatchResultShell: hubspotPushBatchResultShellMock,
}));

import HubspotBatchResultPage from "./page";

describe("hubspot batch result page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the HubSpot batch result shell from route params without fetching in the page", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const html = renderToStaticMarkup(
      await HubspotBatchResultPage({
        params: Promise.resolve({ batchId: "batch-123" }),
      }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(hubspotPushBatchResultShellMock.mock.calls[0]?.[0]).toEqual({
      batchId: "batch-123",
    });
    expect(html).toContain("<h1>HubSpot Batch Result</h1>");
    expect(html).toContain(
      "Review stored row outcomes, visible failures, CSV readiness, and legacy fallback detail for a single HubSpot batch.",
    );
    expect(html).toContain("hubspot-push-batch-result-shell:batch-123");
  });
});
