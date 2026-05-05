import { queueDueChannelLlmEnrichments } from "@scouting-platform/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startContinuousEnrichmentMonitor } from "./continuous-enrichment-monitor";

vi.mock("@scouting-platform/core", () => ({
  queueDueChannelLlmEnrichments: vi.fn(),
}));

function buildScanResult(overrides?: Partial<Awaited<ReturnType<typeof queueDueChannelLlmEnrichments>>>) {
  return {
    scannedAt: new Date("2026-05-04T10:00:00.000Z"),
    staleThreshold: new Date("2026-04-04T10:00:00.000Z"),
    queued: 0,
    skipped: 0,
    failed: 0,
    missingYoutubeCredential: false,
    queuedChannelIds: [],
    ...overrides,
  };
}

describe("continuous enrichment monitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(queueDueChannelLlmEnrichments).mockReset();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("runs the scanner on the configured delay and interval", async () => {
    vi.mocked(queueDueChannelLlmEnrichments).mockResolvedValue(buildScanResult());
    const monitor = startContinuousEnrichmentMonitor(
      { send: vi.fn() },
      {
        enabled: true,
        intervalMs: 1000,
        initialDelayMs: 100,
        batchSize: 7,
        staleAfterDays: 30,
        maxRetryCount: 5,
        processingTimeoutMs: 1800000,
        queuedTimeoutMs: 600000,
      },
    );

    await vi.advanceTimersByTimeAsync(99);
    expect(queueDueChannelLlmEnrichments).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(queueDueChannelLlmEnrichments).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(queueDueChannelLlmEnrichments).toHaveBeenCalledTimes(2);
    expect(vi.mocked(queueDueChannelLlmEnrichments).mock.calls[0]?.[0]).toMatchObject({
      batchSize: 7,
      staleAfterDays: 30,
      maxRetryCount: 5,
      processingTimeoutMs: 1800000,
      queuedTimeoutMs: 600000,
    });

    monitor.stop();
  });

  it("sends claimed enrichment jobs through pg-boss with retry options", async () => {
    const payload = {
      channelId: "11111111-1111-4111-8111-111111111111",
      requestedByUserId: "22222222-2222-4222-8222-222222222222",
    };
    vi.mocked(queueDueChannelLlmEnrichments).mockImplementation(async ({ enqueue }) => {
      await enqueue(payload);
      return buildScanResult({
        queued: 1,
        queuedChannelIds: [payload.channelId],
      });
    });
    const send = vi.fn(async () => "job-id");
    const monitor = startContinuousEnrichmentMonitor(
      { send },
      {
        enabled: false,
        intervalMs: 1000,
        initialDelayMs: 0,
        batchSize: 5,
        staleAfterDays: 30,
        maxRetryCount: 5,
        processingTimeoutMs: 1800000,
        queuedTimeoutMs: 600000,
      },
    );

    await monitor.runOnce();

    expect(send).toHaveBeenCalledWith("channels.enrich.llm", payload, {
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
    });
  });

  it("does not overlap scans when a prior scan is still running", async () => {
    let resolveScan: (value: Awaited<ReturnType<typeof queueDueChannelLlmEnrichments>>) => void;
    vi.mocked(queueDueChannelLlmEnrichments).mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );
    const monitor = startContinuousEnrichmentMonitor(
      { send: vi.fn() },
      {
        enabled: false,
        intervalMs: 1000,
        initialDelayMs: 0,
        batchSize: 5,
        staleAfterDays: 30,
        maxRetryCount: 5,
        processingTimeoutMs: 1800000,
        queuedTimeoutMs: 600000,
      },
    );

    const firstRun = monitor.runOnce();
    await monitor.runOnce();
    expect(queueDueChannelLlmEnrichments).toHaveBeenCalledTimes(1);

    resolveScan!(buildScanResult());
    await firstRun;
  });
});
