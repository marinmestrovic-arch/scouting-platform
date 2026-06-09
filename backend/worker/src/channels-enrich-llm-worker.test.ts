import {
  executeChannelLlmEnrichment,
  executeChannelYoutubeRefresh,
  ServiceError,
} from "@scouting-platform/core";
import type { PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  channelsEnrichLlmWorkerOptions,
  registerChannelsEnrichLlmWorker,
} from "./channels-enrich-llm-worker";

vi.mock("@scouting-platform/core", () => ({
  executeChannelLlmEnrichment: vi.fn(),
  executeChannelYoutubeRefresh: vi.fn(),
  ServiceError: class ServiceError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, status: number, message: string) {
      super(message);
      this.name = "ServiceError";
      this.code = code;
      this.status = status;
    }
  },
}));

describe("channels.enrich.llm worker registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers channels.enrich.llm with explicit bounded concurrency options", async () => {
    const work = vi.fn(async () => "channels-enrich-llm-worker");

    await registerChannelsEnrichLlmWorker({ work } as unknown as Pick<PgBoss, "work">);

    expect(work).toHaveBeenCalledTimes(1);
    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected channels.enrich.llm worker to be registered");
    }

    const [name, options] = call as unknown as [
      string,
      typeof channelsEnrichLlmWorkerOptions,
      unknown,
    ];
    expect(name).toBe("channels.enrich.llm");
    expect(options).toEqual(channelsEnrichLlmWorkerOptions);
  });

  it("parses and executes each job payload", async () => {
    const work = vi.fn(async () => "channels-enrich-llm-worker");

    await registerChannelsEnrichLlmWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected channels.enrich.llm worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof channelsEnrichLlmWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    const requestA = {
      channelId: "11111111-1111-4111-8111-111111111111",
      requestedByUserId: "22222222-2222-4222-8222-222222222222",
    };
    const requestB = {
      channelId: "33333333-3333-4333-8333-333333333333",
      requestedByUserId: "44444444-4444-4444-8444-444444444444",
      mode: "full" as const,
    };

    await handler([
      { data: requestA },
      { data: requestB },
    ]);

    expect(vi.mocked(executeChannelLlmEnrichment)).toHaveBeenNthCalledWith(1, requestA);
    expect(vi.mocked(executeChannelLlmEnrichment)).toHaveBeenNthCalledWith(2, requestB);
    expect(vi.mocked(executeChannelYoutubeRefresh)).not.toHaveBeenCalled();
  });

  it("dispatches youtube-only payloads to the YouTube refresh executor", async () => {
    const work = vi.fn(async () => "channels-enrich-llm-worker");

    await registerChannelsEnrichLlmWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected channels.enrich.llm worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof channelsEnrichLlmWorkerOptions,
      (job: unknown) => Promise<void>,
    ];
    const request = {
      channelId: "11111111-1111-4111-8111-111111111111",
      requestedByUserId: "22222222-2222-4222-8222-222222222222",
      mode: "youtube_only" as const,
    };

    await handler({ data: request });

    expect(vi.mocked(executeChannelYoutubeRefresh)).toHaveBeenCalledWith(request);
    expect(vi.mocked(executeChannelLlmEnrichment)).not.toHaveBeenCalled();
  });

  it("records durable service failures without rethrowing for pg-boss retry", async () => {
    const work = vi.fn(async () => "channels-enrich-llm-worker");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(executeChannelLlmEnrichment).mockRejectedValueOnce(
      new ServiceError("YOUTUBE_CONTEXT_FAILED", 502, "YouTube channel context request failed"),
    );

    await registerChannelsEnrichLlmWorker({ work } as unknown as Pick<PgBoss, "work">);

    const call = work.mock.calls[0];

    if (!call) {
      throw new Error("Expected channels.enrich.llm worker to be registered");
    }

    const [, , handler] = call as unknown as [
      string,
      typeof channelsEnrichLlmWorkerOptions,
      (job: unknown) => Promise<void>,
    ];

    await expect(
      handler({
        data: {
          channelId: "11111111-1111-4111-8111-111111111111",
          requestedByUserId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ).resolves.toBeUndefined();
    expect(stderrSpy).toHaveBeenCalledWith(
      "[worker] channels.enrich.llm recorded failure for 11111111-1111-4111-8111-111111111111: YOUTUBE_CONTEXT_FAILED (502): YouTube channel context request failed\n",
    );
  });
});
