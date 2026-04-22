import { describe, expect, it, vi } from "vitest";

import {
  OpenAiChannelEnrichmentError,
  type EnrichChannelWithOpenAiInput,
  extractStoredOpenAiChannelEnrichmentProfileFromRawPayload,
  enrichChannelWithOpenAi,
} from "./channel-enrichment";

const STRUCTURED_PROFILE = {
  primaryNiche: "gaming",
  secondaryNiches: ["commentary_reaction"],
  contentFormats: ["long_form", "live_stream"],
  brandFitTags: ["gaming_hardware", "consumer_tech"],
  language: "en",
  geoHints: ["US"],
  sponsorSignals: ["live-service game coverage"],
  brandSafety: {
    status: "low",
    flags: [],
    rationale: "No clear adult, gambling, or controversy signals in the provided sample.",
  },
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
    defaultLanguage: "en-US",
    subscriberCount: 1000,
    viewCount: 100000,
    videoCount: 42,
    recentVideos: [
      {
        youtubeVideoId: "video-1",
        title: "Video 1",
        description: "Description 1",
        publishedAt: "2024-01-01T00:00:00Z",
        viewCount: null,
        likeCount: null,
        commentCount: null,
        durationSeconds: null,
        isShort: null,
        categoryId: null,
        categoryName: null,
        tags: [],
      },
    ],
    diagnostics: {
      warnings: [],
    },
  },
  derivedSignals: {
    topKeywords: ["gaming", "commentary", "launch"],
    topicClusters: ["gaming", "reviews_comparisons"],
    dominantYoutubeCategoryName: "Gaming",
    contentMixHint: "long_form",
    uploadCadenceHint: "weekly",
  },
} satisfies EnrichChannelWithOpenAiInput;

function createStructuredResponse(overrides?: Record<string, unknown>) {
  return {
    summary: "Creator focused on gaming commentary.",
    topics: ["gaming", "commentary"],
    brandFitNotes: "Strong fit for gaming peripherals and live-service titles.",
    confidence: 0.82,
    structuredProfile: STRUCTURED_PROFILE,
    ...(overrides ?? {}),
  };
}

describe("enrichChannelWithOpenAi", () => {
  it("sends a compact, slimmed youtube context prompt with derived signals and taxonomy hints", async () => {
    const longDescription = "x".repeat(240);
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createStructuredResponse()),
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
          viewCount: index + 100,
          likeCount: index + 10,
          commentCount: index + 1,
          durationSeconds: 600 + index,
          isShort: false,
          categoryId: "20",
          categoryName: "Gaming",
          tags: [`tag-${index + 1}`],
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
      derivedSignals: typeof TEST_INPUT.derivedSignals;
      taxonomyHints: {
        primaryNicheValues: string[];
        contentFormatValues: string[];
        brandFitTagValues: string[];
      };
      youtubeContext: {
        defaultLanguage: string | null;
        description?: string;
        recentVideos: Array<{
          description: string | null;
          durationSeconds: number | null;
          isShort: boolean | null;
          categoryId: string | null;
          categoryName: string | null;
          tags: string[];
        }>;
      };
    };

    expect(parsed.youtubeContext).not.toHaveProperty("description");
    expect(parsed.youtubeContext.defaultLanguage).toBe("en-US");
    expect(parsed.youtubeContext.recentVideos).toHaveLength(5);
    expect(
      parsed.youtubeContext.recentVideos.every(
        (video) => video.description === null || video.description.length <= 200,
      ),
    ).toBe(true);
    expect(parsed.youtubeContext.recentVideos[0]?.isShort).toBe(false);
    expect(parsed.youtubeContext.recentVideos[0]?.tags).toEqual(["tag-1"]);
    expect(parsed.derivedSignals).toEqual(TEST_INPUT.derivedSignals);
    expect(parsed.taxonomyHints.primaryNicheValues).toContain("gaming");
    expect(parsed.taxonomyHints.contentFormatValues).toContain("long_form");
    expect(parsed.taxonomyHints.brandFitTagValues).toContain("consumer_tech");
  });

  it("uses gpt-5-nano by default and omits temperature", async () => {
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ id: string; choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      id: "resp-default-model",
      choices: [
        {
          message: {
            content: JSON.stringify(createStructuredResponse()),
          },
        },
      ],
    }));

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

    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createStructuredResponse()),
          },
        },
      ],
    }));

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

    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createStructuredResponse()),
          },
        },
      ],
    }));

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
                    content: JSON.stringify(createStructuredResponse()),
                  },
                },
              ],
            }),
          },
        },
      },
    });

    expect(result.profile).toEqual(createStructuredResponse());
    expect(result.rawPayload.id).toBe("resp-1");
  });

  it("accepts model output without structuredProfile as a legacy profile", async () => {
    const result = await enrichChannelWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: "Creator focused on gaming commentary.",
                      topics: ["gaming"],
                      brandFitNotes: "Strong fit for gaming peripherals.",
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
      topics: ["gaming"],
      brandFitNotes: "Strong fit for gaming peripherals.",
      confidence: 0.82,
      structuredProfile: null,
    });
  });

  it("normalizes structuredProfile enum drift instead of failing enrichment", async () => {
    const result = await enrichChannelWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify(
                      createStructuredResponse({
                        structuredProfile: {
                          ...STRUCTURED_PROFILE,
                          primaryNiche: "unknown vertical",
                          contentFormats: ["short form", "livestream"],
                          brandFitTags: ["technology", "gaming"],
                          brandSafety: {
                            status: "safe",
                            flags: ["political", "violence"],
                            rationale: "",
                          },
                        },
                      }),
                    ),
                  },
                },
              ],
            }),
          },
        },
      },
    });

    expect(result.profile.structuredProfile).toMatchObject({
      primaryNiche: "other",
      contentFormats: ["shorts", "live_stream"],
      brandFitTags: ["consumer_tech", "gaming_hardware"],
      brandSafety: {
        status: "unknown",
        flags: ["violence"],
      },
    });
    expect(result.profile.structuredProfile?.brandSafety.rationale).toBe(
      "Insufficient evidence for specific brand-safety concerns in the provided context.",
    );
  });

  it("normalizes weak but parseable enrichment output to safe defaults", async () => {
    const result = await enrichChannelWithOpenAi({
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
                      confidence: "not a number",
                      structuredProfile: {
                        primaryNiche: "",
                        contentFormats: [],
                        language: "e",
                        geoHints: ["U", "Croatia"],
                        brandSafety: {},
                      },
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
      summary: "Creator profile generated from the available YouTube channel context.",
      topics: ["other"],
      brandFitNotes: "No clear brand-fit constraints were identified from the available context.",
      confidence: 0.5,
      structuredProfile: {
        primaryNiche: "other",
        secondaryNiches: [],
        contentFormats: ["mixed"],
        brandFitTags: [],
        language: null,
        geoHints: ["Croatia"],
        sponsorSignals: [],
        brandSafety: {
          status: "unknown",
          flags: [],
          rationale:
            "Insufficient evidence for specific brand-safety concerns in the provided context.",
        },
      },
    });
  });

  it("parses JSON object output wrapped in a markdown fence", async () => {
    const result = await enrichChannelWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: `\`\`\`json\n${JSON.stringify(createStructuredResponse())}\n\`\`\``,
                  },
                },
              ],
            }),
          },
        },
      },
    });

    expect(result.profile).toEqual(createStructuredResponse());
  });

  it("falls back to safe defaults when model text is not JSON", async () => {
    const result = await enrichChannelWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: "This channel appears to cover gaming and commentary.",
                  },
                },
              ],
            }),
          },
        },
      },
    });

    expect(result.profile).toEqual({
      summary: "Creator profile generated from the available YouTube channel context.",
      topics: ["other"],
      brandFitNotes: "No clear brand-fit constraints were identified from the available context.",
      confidence: 0.5,
      structuredProfile: null,
    });
  });

  it("parses legacy stored payloads and fills structuredProfile with null", () => {
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
