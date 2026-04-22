import { executeHubspotPreviewEnrichmentJob } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { describe, expect, it, vi } from "vitest";

import {
  hubspotPreviewEnrichWorkerOptions,
  registerHubspotPreviewEnrichWorker,
} from "./hubspot-preview-enrich-worker";

vi.mock("@scouting-platform/core", () => ({
  executeHubspotPreviewEnrichmentJob: vi.fn(),
}));

describe("hubspot-preview.enrich worker registration", () => {
  it("registers hubspot-preview.enrich with explicit bounded concurrency options", async () => {
    const work = vi.fn(async () => "hubspot-preview-enrich-worker");

    await registerHubspotPreviewEnrichWorker({ work } as unknown as Pick<PgBoss, "work">);

    expect(work).toHaveBeenCalledTimes(1);
    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected hubspot-preview.enrich worker to be registered");
    }

    const [name, options] = call as unknown as [
      string,
      typeof hubspotPreviewEnrichWorkerOptions,
      unknown,
    ];
    expect(name).toBe("hubspot-preview.enrich");
    expect(options).toEqual(hubspotPreviewEnrichWorkerOptions);
  });

  it("parses and executes each job payload", async () => {
    const work = vi.fn(async () => "hubspot-preview-enrich-worker");

    await registerHubspotPreviewEnrichWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected hubspot-preview.enrich worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof hubspotPreviewEnrichWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    const requestA = {
      enrichmentJobId: "11111111-1111-4111-8111-111111111111",
      requestedByUserId: "22222222-2222-4222-8222-222222222222",
    };
    const requestB = {
      enrichmentJobId: "33333333-3333-4333-8333-333333333333",
      requestedByUserId: "44444444-4444-4444-8444-444444444444",
    };

    await handler([{ data: requestA }, { data: requestB }]);

    expect(vi.mocked(executeHubspotPreviewEnrichmentJob)).toHaveBeenNthCalledWith(1, requestA);
    expect(vi.mocked(executeHubspotPreviewEnrichmentJob)).toHaveBeenNthCalledWith(2, requestB);
  });
});
