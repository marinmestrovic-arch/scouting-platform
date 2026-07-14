import {
  RunChannelAssessmentStatus,
  RunRequestStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => {
  const tx = {
    runResult: {
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    runRequest: {
      update: vi.fn(),
    },
  };

  return {
    prismaMock: {
      runRequest: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      runResult: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      __tx: tx,
    },
  };
});

vi.mock("@scouting-platform/db", () => ({
  prisma: prismaMock,
}));

import { finalizeRunAssessmentRankingIfReady, updateRunResultRating } from "./repository";

describe("run repository assessment ranking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes a running run by fit score and trims to the target", async () => {
    prismaMock.runRequest.findUnique.mockResolvedValueOnce({
      id: "run-1",
      status: RunRequestStatus.RUNNING,
      target: 1,
      results: [
        {
          id: "result-1",
          channelId: "channel-1",
          rank: 1,
        },
        {
          id: "result-2",
          channelId: "channel-2",
          rank: 2,
        },
      ],
      channelAssessments: [
        {
          channelId: "channel-1",
          status: RunChannelAssessmentStatus.COMPLETED,
          fitScore: 0.4,
        },
        {
          channelId: "channel-2",
          status: RunChannelAssessmentStatus.COMPLETED,
          fitScore: 0.95,
        },
      ],
    });

    await finalizeRunAssessmentRankingIfReady({
      runRequestId: "run-1",
    });

    expect(prismaMock.__tx.runResult.deleteMany).toHaveBeenCalledWith({
      where: {
        runRequestId: "run-1",
        id: {
          notIn: ["result-2"],
        },
      },
    });
    expect(prismaMock.__tx.runResult.update).toHaveBeenCalledWith({
      where: {
        id: "result-2",
      },
      data: {
        rank: 1,
      },
    });
    expect(prismaMock.__tx.runRequest.update).toHaveBeenCalledWith({
      where: {
        id: "run-1",
      },
      data: expect.objectContaining({
        status: RunRequestStatus.COMPLETED,
        lastError: null,
      }),
    });
  });

  it("removes low-fit and failed assessments instead of filling the target", async () => {
    prismaMock.runRequest.findUnique.mockResolvedValueOnce({
      id: "run-1",
      status: RunRequestStatus.RUNNING,
      target: 10,
      results: [
        {
          id: "result-1",
          channelId: "channel-1",
          rank: 1,
        },
        {
          id: "result-2",
          channelId: "channel-2",
          rank: 2,
        },
      ],
      channelAssessments: [
        {
          channelId: "channel-1",
          status: RunChannelAssessmentStatus.COMPLETED,
          fitScore: 0.54,
        },
        {
          channelId: "channel-2",
          status: RunChannelAssessmentStatus.FAILED,
          fitScore: null,
        },
      ],
    });

    await finalizeRunAssessmentRankingIfReady({
      runRequestId: "run-1",
    });

    expect(prismaMock.__tx.runResult.deleteMany).toHaveBeenCalledWith({
      where: {
        runRequestId: "run-1",
      },
    });
    expect(prismaMock.__tx.runResult.update).not.toHaveBeenCalled();
    expect(prismaMock.__tx.runRequest.update).toHaveBeenCalledWith({
      where: {
        id: "run-1",
      },
      data: expect.objectContaining({
        status: RunRequestStatus.COMPLETED,
        lastError: null,
      }),
    });
  });
});

describe("run result ratings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores an owner rating with attribution", async () => {
    prismaMock.runResult.findUnique.mockResolvedValueOnce({
      id: "result-1",
      runRequestId: "run-1",
      channelId: "channel-1",
      runRequest: {
        requestedByUserId: "user-1",
        status: RunRequestStatus.COMPLETED,
      },
    });
    prismaMock.runResult.update.mockResolvedValueOnce({
      id: "result-1",
      runRequestId: "run-1",
      channelId: "channel-1",
      rating: 5,
      ratedAt: new Date("2026-06-15T12:00:00.000Z"),
    });

    const result = await updateRunResultRating({
      runId: "run-1",
      resultId: "result-1",
      userId: "user-1",
      role: "user",
      rating: 5,
    });

    expect(prismaMock.runResult.update).toHaveBeenCalledWith({
      where: {
        id: "result-1",
      },
      data: {
        rating: 5,
        ratedAt: expect.any(Date),
        ratedByUserId: "user-1",
      },
      select: expect.any(Object),
    });
    expect(result).toEqual({
      runId: "run-1",
      resultId: "result-1",
      channelId: "channel-1",
      rating: 5,
      ratedAt: "2026-06-15T12:00:00.000Z",
    });
  });

  it("clears rating attribution", async () => {
    prismaMock.runResult.findUnique.mockResolvedValueOnce({
      id: "result-1",
      runRequestId: "run-1",
      channelId: "channel-1",
      runRequest: {
        requestedByUserId: "user-1",
        status: RunRequestStatus.COMPLETED,
      },
    });
    prismaMock.runResult.update.mockResolvedValueOnce({
      id: "result-1",
      runRequestId: "run-1",
      channelId: "channel-1",
      rating: null,
      ratedAt: null,
    });

    await updateRunResultRating({
      runId: "run-1",
      resultId: "result-1",
      userId: "user-1",
      role: "user",
      rating: null,
    });

    expect(prismaMock.runResult.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          rating: null,
          ratedAt: null,
          ratedByUserId: null,
        },
      }),
    );
  });

  it("rejects non-owner ratings", async () => {
    prismaMock.runResult.findUnique.mockResolvedValueOnce({
      id: "result-1",
      runRequestId: "run-1",
      channelId: "channel-1",
      runRequest: {
        requestedByUserId: "user-1",
        status: RunRequestStatus.COMPLETED,
      },
    });

    await expect(
      updateRunResultRating({
        runId: "run-1",
        resultId: "result-1",
        userId: "user-2",
        role: "user",
        rating: 4,
      }),
    ).rejects.toMatchObject({
      code: "RUN_RESULT_FORBIDDEN",
      status: 403,
    });
    expect(prismaMock.runResult.update).not.toHaveBeenCalled();
  });

  it("rejects invalid ratings before querying the database", async () => {
    await expect(
      updateRunResultRating({
        runId: "run-1",
        resultId: "result-1",
        userId: "user-1",
        role: "user",
        rating: 6,
      }),
    ).rejects.toMatchObject({
      code: "RUN_RESULT_RATING_INVALID",
      status: 400,
    });
    expect(prismaMock.runResult.findUnique).not.toHaveBeenCalled();
  });

  it("waits for the run snapshot to complete before accepting ratings", async () => {
    prismaMock.runResult.findUnique.mockResolvedValueOnce({
      id: "result-1",
      runRequestId: "run-1",
      channelId: "channel-1",
      runRequest: {
        requestedByUserId: "user-1",
        status: RunRequestStatus.RUNNING,
      },
    });

    await expect(
      updateRunResultRating({
        runId: "run-1",
        resultId: "result-1",
        userId: "user-1",
        role: "user",
        rating: 4,
      }),
    ).rejects.toMatchObject({
      code: "RUN_RESULT_RATING_NOT_READY",
      status: 409,
    });
    expect(prismaMock.runResult.update).not.toHaveBeenCalled();
  });
});
