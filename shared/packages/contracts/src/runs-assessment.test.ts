import { describe, expect, it } from "vitest";

import {
  runChannelAssessmentItemSchema,
  triggerRunAssessmentResponseSchema,
} from "./runs-assessment";

const TEST_UUID = "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b";
const TEST_CHANNEL_UUID = "24a57b02-3008-4af1-9b3a-340bd0db7d1c";

function buildAssessment() {
  return {
    id: TEST_UUID,
    runRequestId: TEST_UUID,
    channelId: TEST_CHANNEL_UUID,
    status: "completed" as const,
    model: "gpt-4.1-mini",
    fitScore: 0.8,
    fitReasons: ["Strong audience match"],
    fitConcerns: ["Limited family-safe inventory"],
    recommendedAngles: ["Benchmark-style product comparison"],
    avoidTopics: ["Off-brief giveaways"],
    assessedAt: new Date().toISOString(),
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("run assessment contracts", () => {
  it("parses a valid run channel assessment item", () => {
    const payload = runChannelAssessmentItemSchema.parse(buildAssessment());

    expect(payload.fitScore).toBe(0.8);
    expect(payload.status).toBe("completed");
  });

  it("rejects fitScore greater than 1", () => {
    expect(() =>
      runChannelAssessmentItemSchema.parse({
        ...buildAssessment(),
        fitScore: 1.5,
      }),
    ).toThrow();
  });

  it("rejects fitScore below 0", () => {
    expect(() =>
      runChannelAssessmentItemSchema.parse({
        ...buildAssessment(),
        fitScore: -0.1,
      }),
    ).toThrow();
  });

  it("rejects invalid assessment statuses", () => {
    const parsed = runChannelAssessmentItemSchema.safeParse({
      ...buildAssessment(),
      status: "unknown",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects negative enqueue counts in the trigger response", () => {
    expect(() =>
      triggerRunAssessmentResponseSchema.parse({
        runId: TEST_UUID,
        enqueued: -1,
        skipped: 0,
        assessments: [buildAssessment()],
      }),
    ).toThrow();
  });
});
