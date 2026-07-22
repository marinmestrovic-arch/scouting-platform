import { processHubspotWebhookEvent } from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  hubspotWebhookWorkerOptions,
  registerHubspotWebhookWorker,
} from "./hubspot-webhook-worker";

vi.mock("@scouting-platform/core", () => ({
  processHubspotWebhookEvent: vi.fn(),
}));

describe("hubspot.webhook.process worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers with explicit bounded concurrency and parses its payload", async () => {
    const work = vi.fn(async () => "registered");
    await registerHubspotWebhookWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];
    if (!call) {
      throw new Error("Expected hubspot.webhook.process worker to be registered");
    }
    const [name, options, handler] = call as unknown as [
      string,
      typeof hubspotWebhookWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    expect(name).toBe("hubspot.webhook.process");
    expect(options).toEqual(hubspotWebhookWorkerOptions);
    expect(options).toEqual({ localConcurrency: 2, batchSize: 1 });

    const payload = { webhookEventId: "11111111-1111-4111-8111-111111111111" };
    await handler({ data: payload });

    expect(vi.mocked(processHubspotWebhookEvent)).toHaveBeenCalledWith(payload);
  });

  it("rejects malformed payloads before delegating", async () => {
    const work = vi.fn(async () => "registered");
    await registerHubspotWebhookWorker({ work } as unknown as Pick<PgBoss, "work">);
    const call = work.mock.calls[0];
    if (!call) {
      throw new Error("Expected hubspot.webhook.process worker to be registered");
    }
    const [, , handler] = call as unknown as [
      string,
      typeof hubspotWebhookWorkerOptions,
      (job: unknown) => Promise<void>,
    ];

    await expect(handler({ data: { webhookEventId: "not-a-uuid" } })).rejects.toThrow();
    expect(vi.mocked(processHubspotWebhookEvent)).not.toHaveBeenCalled();
  });
});
