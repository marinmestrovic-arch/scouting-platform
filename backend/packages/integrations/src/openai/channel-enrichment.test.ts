import { describe, expect, it, vi } from "vitest";

import {
  OpenAiChannelEnrichmentError,
  extractStoredOpenAiChannelEnrichmentProfileFromRawPayload,
  enrichChannelWithOpenAi,
} from "./channel-enrichment";

const STRUCTURED_PROFILE = {
  metadata: {
    language: "en",
    contentFormats: ["long_form"],
    sponsorSignals: ["affiliate_links"],
    geoHints: ["US"],
    uploadCadenceHint: "weekly",
  },
  niche: {
    primary: "gaming_commentary",
    secondary: ["live_service_games"],
    confidence: 0.84,
  },
  brandSafety: {
    status: "safe",
    flags: [],
    rationale: "Commentary focuses on mainstream gaming topics without visible safety concerns.",
    confidence: 0.78,
  },
} as const;

const VALID_PROFILE_PAYLOAD = {
  summary: "Creator focused on gaming commentary.",
  topics: ["gaming", "commentary"],
  brandFitNotes: "Strong fit for gaming peripherals and live-service titles.",
  confidence: 0.82,
  structuredProfile: STRUCTURED_PROFILE,
} as const;

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
        durationSeconds: 640,
        isShort: false,
        viewCount: null,
        likeCount: null,
        commentCount: null,
        categoryId: "20",
        tags: ["gameplay", "commentary"],
      },
    ],
    diagnostics: {
      warnings: [],
    },
  },
};

describe("enrichChannelWithOpenAi", () => {
  it("sends a compact, slimmed youtube context prompt", async () => {
    const longDescription = "x".repeat(240);
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(VALID_PROFILE_PAYLOAD),
          },
        },
      ],
    }));

    await enrichChannelWithOpenAi({
      ...TEST_INPUT,
      youtubeContext: {
        ...TEST_INPUT.youtubeContext,
        description: "A long top-level youtube description that should be omitted from the prompt.",
        recentVideos: Array.from({ length: 6 }, (_, index) => ({
          youtubeVideoId: `video-${index + 1}`,
          title: `Video ${index + 1}`,
          description: index === 0 ? longDescription : `Description ${index + 1}`,
          publishedAt: "2024-01-01T00:00:00Z",
          durationSeconds: index === 0 ? 120 : 600 + index,
          isShort: index === 0,
          viewCount: index + 100,
          likeCount: index + 10,
          commentCount: index + 1,
          categoryId: "20",
          tags: [`tag-${index + 1}`, "gaming"],
        })),
        diagnostics: {
          warnings: ["some warning"],
        },
      },
      client: {
        chat: {
          completions: {
            create,
          },
        },
      },
    });

    const request = create.mock.calls[0]?.[0] as
      | { messages?: Array<{ content?: unknown }> }
      | undefined;
    const content = request?.messages?.[1]?.content;

    expect(typeof content).toBe("string");
    expect(content).not.toContain('"diagnostics"');
    expect(content).toMatch(/^\{"channel":/);

    const parsed = JSON.parse(content as string) as {
      youtubeContext: {
        description?: string;
        recentVideos: Array<{
          description: string | null;
          durationSeconds: number | null;
          isShort: boolean | null;
          categoryId: string | null;
          tags: string[];
        }>;
      };
    };

    expect(parsed.youtubeContext).not.toHaveProperty("description");
    expect(parsed.youtubeContext.recentVideos).toHaveLength(5);
    expect(
      parsed.youtubeContext.recentVideos.every(
        (video) => video.description === null || video.description.length <= 200,
      ),
    ).toBe(true);
    expect(parsed.youtubeContext.recentVideos[0]).toMatchObject({
      durationSeconds: 120,
      isShort: true,
      categoryId: "20",
      tags: ["tag-1", "gaming"],
    });
  });

  it("uses gpt-5-nano by default and omits temperature", async () => {
    const create = vi.fn<(input: Record<string, unknown>) => Promise<{ id: string; choices: Array<{ message: { content: string } }> }>>(
      async () => ({
        id: "resp-default-model",
        choices: [
          {
            message: {
              content: JSON.stringify(VALID_PROFILE_PAYLOAD),
            },
          },
        ],
      }),
    );

    await enrichChannelWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create,
          },
        },
      },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5-nano",
      }),
    );
    const request = create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(request).toBeDefined();
    expect(request).not.toHaveProperty("temperature");
  });

  it("uses OPENAI_MODEL when no explicit model override is passed", async () => {
    const originalModel = process.env.OPENAI_MODEL;
    process.env.OPENAI_MODEL = "gpt-5";

    const create = vi.fn<(input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>>(
      async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(VALID_PROFILE_PAYLOAD),
            },
          },
        ],
      }),
    );

    try {
      await enrichChannelWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create,
            },
          },
        },
      });
    } finally {
      if (originalModel === undefined) {
        delete process.env.OPENAI_MODEL;
      } else {
        process.env.OPENAI_MODEL = originalModel;
      }
    }

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5",
      }),
    );
  });

  it("prefers the explicit model override over OPENAI_MODEL", async () => {
    const originalModel = process.env.OPENAI_MODEL;
    process.env.OPENAI_MODEL = "gpt-5-nano";

    const create = vi.fn<(input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>>(
      async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify(VALID_PROFILE_PAYLOAD),
            },
          },
        ],
      }),
    );

    try {
      await enrichChannelWithOpenAi({
        ...TEST_INPUT,
        model: "gpt-5",
        client: {
          chat: {
            completions: {
              create,
            },
          },
        },
      });
    } finally {
      if (originalModel === undefined) {
        delete process.env.OPENAI_MODEL;
      } else {
        process.env.OPENAI_MODEL = originalModel;
      }
    }

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5",
      }),
    );
  });

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
                    content: JSON.stringify(VALID_PROFILE_PAYLOAD),
                  },
                },
              ],
            }),
          },
        },
      },
    });

    expect(result.profile).toEqual(VALID_PROFILE_PAYLOAD);
    expect(result.rawPayload.id).toBe("resp-1");
  });

  it("can recover legacy stored payloads that predate structuredProfile", () => {
    const profile = extractStoredOpenAiChannelEnrichmentProfileFromRawPayload({
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
    });

    expect(profile).toEqual({
      summary: "Creator focused on gaming commentary.",
      topics: ["gaming", "commentary"],
      brandFitNotes: "Strong fit for gaming peripherals and live-service titles.",
      confidence: 0.82,
      structuredProfile: null,
    });
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
