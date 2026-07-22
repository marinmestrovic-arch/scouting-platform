import { executeHubspotHealthCheckRun } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hubspotHealthCheckWorkerOptions,
  registerHubspotHealthCheckWorker,
} from "./hubspot-health-check-worker";

vi.mock("@scouting-platform/core", () => ({
  executeHubspotHealthCheckRun: vi.fn(),
}));

const payload = {
  healthCheckRunId: "11111111-1111-4111-8111-111111111111",
  requestedByUserId: "22222222-2222-4222-8222-222222222222",
};

async function captureHandler(): Promise<(job: unknown) => Promise<void>> {
  const work = vi.fn(async () => "hubspot-health-check-worker");
  await registerHubspotHealthCheckWorker(
    { work } as unknown as Pick<PgBoss, "work">,
  );
  const call = work.mock.calls[0];

  if (!call) {
    throw new Error("Expected hubspot.health-check worker registration");
  }

  const [name, options, handler] = call as unknown as [
    string,
    typeof hubspotHealthCheckWorkerOptions,
    (job: unknown) => Promise<void>,
  ];
  expect(name).toBe("hubspot.health-check");
  expect(options).toEqual(hubspotHealthCheckWorkerOptions);
  return handler;
}

describe("hubspot.health-check worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses and delegates each durable health-check run", async () => {
    const handler = await captureHandler();

    await handler([{ data: payload }]);

    expect(vi.mocked(executeHubspotHealthCheckRun)).toHaveBeenCalledWith(payload);
  });

  it("rejects malformed payloads before executing core logic", async () => {
    const handler = await captureHandler();

    await expect(handler({ data: { requestedByUserId: payload.requestedByUserId } }))
      .rejects.toThrow();
    expect(vi.mocked(executeHubspotHealthCheckRun)).not.toHaveBeenCalled();
  });

  it("rethrows execution failures for queue retry handling", async () => {
    const handler = await captureHandler();
    vi.mocked(executeHubspotHealthCheckRun).mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(handler({ data: payload })).rejects.toThrow("database unavailable");
  });
});
