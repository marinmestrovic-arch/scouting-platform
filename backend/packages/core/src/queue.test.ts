import { beforeEach, describe, expect, it, vi } from "vitest";

const { createQueue, insert, send, start, stop } = vi.hoisted(() => ({
  createQueue: vi.fn(async () => undefined),
  insert: vi.fn(async () => ["job-id"]),
  send: vi.fn(async () => "job-id"),
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
}));

vi.mock("pg-boss", () => ({
  PgBoss: class PgBoss {
    createQueue = createQueue;
    insert = insert;
    send = send;
    start = start;
    stop = stop;
  },
}));

import {
  enqueueChannelLlmJobs,
  enqueueJob,
  stopQueueRuntime,
} from "./queue";

const payload = {
  channelId: "11111111-1111-4111-8111-111111111111",
  requestedByUserId: "22222222-2222-4222-8222-222222222222",
};

describe("queue helpers", () => {
  beforeEach(async () => {
    await stopQueueRuntime();
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://scouting:scouting@localhost:5432/scouting_platform";
  });

  it("validates and forwards single-job priority", async () => {
    await enqueueJob("channels.enrich.llm", payload, { priority: 10 });

    expect(send).toHaveBeenCalledWith("channels.enrich.llm", payload, {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      priority: 10,
    });
    await expect(
      enqueueJob("channels.enrich.llm", payload, { priority: 1.5 }),
    ).rejects.toMatchObject({ code: "INVALID_JOB_PRIORITY" });
  });

  it("bulk inserts one validated channel enrichment family", async () => {
    const secondPayload = {
      channelId: "33333333-3333-4333-8333-333333333333",
      requestedByUserId: payload.requestedByUserId,
    };

    await enqueueChannelLlmJobs([payload, secondPayload], { priority: 10 });

    expect(insert).toHaveBeenCalledWith("channels.enrich.llm", [
      {
        data: payload,
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        priority: 10,
      },
      {
        data: secondPayload,
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        priority: 10,
      },
    ]);
  });
});
