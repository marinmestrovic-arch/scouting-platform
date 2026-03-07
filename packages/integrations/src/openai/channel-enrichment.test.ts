import { describe, expect, it } from "vitest";

import {
  OpenAiChannelEnrichmentError,
  enrichChannelWithOpenAi,
} from "./channel-enrichment";

const TEST_INPUT = {
  apiKey: "openai-key",
  channel: {
    youtubeChannelId: "UC-OPENAI-1",
    title: "Channel Name",
    handle: "@channel-name",
    description: "Channel description",
  },
  youtubeContext: {
    youtubeChannelId: "UC-OPENAI-1",
    title: "Channel Name",
    handle: "@channel-name",
    description: "Channel description",
    thumbnailUrl: null,
    publishedAt: null,
    subscriberCount: 1000,
    viewCount: 100000,
    videoCount: 42,
    recentVideos: [
      {
        youtubeVideoId: "video-1",
        title: "Video 1",
        description: "Description 1",
        publishedAt: "2024-01-01T00:00:00Z",
      },
    ],
  },
};

describe("enrichChannelWithOpenAi", () => {
  it("parses structured profile output", async () => {
    const result = await enrichChannelWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create: async () => ({
              id: "resp-1",
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: "Creator focused on gaming commentary.",
                      topics: ["gaming", "commentary"],
                      brandFitNotes: "Strong fit for gaming peripherals and live-service titles.",
                      confidence: 0.82,
                    }),
                  },
                },
              ],
            }),
          },
        },
      },
    });

    expect(result.profile).toEqual({
      summary: "Creator focused on gaming commentary.",
      topics: ["gaming", "commentary"],
      brandFitNotes: "Strong fit for gaming peripherals and live-service titles.",
      confidence: 0.82,
    });
    expect(result.rawPayload.id).toBe("resp-1");
  });

  it("throws when the model returns output that fails schema validation", async () => {
    await expect(
      enrichChannelWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create: async () => ({
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        summary: "",
                        topics: [],
                        brandFitNotes: "",
                        confidence: 4,
                      }),
                    },
                  },
                ],
              }),
            },
          },
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "OPENAI_INVALID_RESPONSE",
        status: 502,
        message: "OpenAI returned invalid enrichment output",
      } satisfies Partial<OpenAiChannelEnrichmentError>),
    );
  });

  it("maps auth failures", async () => {
    await expect(
      enrichChannelWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create: async () => {
                const error = new Error("unauthorized") as Error & { status: number };
                error.status = 401;
                throw error;
              },
            },
          },
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "OPENAI_AUTH_FAILED",
        status: 401,
        message: "OpenAI API key is invalid or unauthorized",
      } satisfies Partial<OpenAiChannelEnrichmentError>),
    );
  });

  it("maps rate limit failures", async () => {
    await expect(
      enrichChannelWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create: async () => {
                const error = new Error("rate limited") as Error & { status: number };
                error.status = 429;
                throw error;
              },
            },
          },
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "OPENAI_RATE_LIMITED",
        status: 429,
        message: "OpenAI rate limit exceeded",
      } satisfies Partial<OpenAiChannelEnrichmentError>),
    );
  });

  it("maps generic provider failures", async () => {
    await expect(
      enrichChannelWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create: async () => {
                throw new Error("boom");
              },
            },
          },
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "OPENAI_ENRICHMENT_FAILED",
        status: 502,
        message: "OpenAI enrichment request failed",
      } satisfies Partial<OpenAiChannelEnrichmentError>),
    );
  });
});
