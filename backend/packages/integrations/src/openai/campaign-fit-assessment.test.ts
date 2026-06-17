import { describe, expect, it, vi } from "vitest";

import {
  OpenAiCampaignFitError,
  type EnrichCampaignFitInput,
  enrichCampaignFitWithOpenAi,
} from "./campaign-fit-assessment";

const TEST_INPUT = {
  apiKey: "openai-key",
  channel: {
    youtubeChannelId: "UC-CAMPAIGN-FIT-1",
    title: "Channel Name",
    handle: "@channel-name",
    description: "Channel description",
  },
  youtubeContext: {
    youtubeChannelId: "UC-CAMPAIGN-FIT-1",
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
  enrichmentProfile: {
    summary: "Gaming commentary creator.",
    topics: ["gaming", "reviews"],
    brandFitNotes: "Works well for consumer tech and gaming hardware.",
  },
  campaignBrief: {
    client: "NVIDIA",
    campaignName: "RTX Launch",
    clientIndustry: "Gaming Hardware",
    campaignObjective: "Drive awareness for a new GPU launch",
    targetAudienceAge: "18-34",
    targetAudienceGender: "All",
    targetGeographies: ["Germany", "Austria"],
    contentRestrictions: ["No political content"],
    budgetTier: "mid",
    deliverables: ["Dedicated video", "Short-form cutdown"],
  },
} satisfies EnrichCampaignFitInput;

function createValidAssessment(overrides?: Record<string, unknown>) {
  return {
    fitScore: 0.84,
    fitReasons: ["Audience and content align with the GPU launch brief."],
    fitConcerns: ["Limited evidence of German-language reach."],
    recommendedAngles: ["Benchmark-style performance breakdown."],
    avoidTopics: ["Console-only positioning."],
    ...(overrides ?? {}),
  };
}

describe("enrichCampaignFitWithOpenAi", () => {
  it("uses the hardcoded gpt-4.1-mini model even when OPENAI_MODEL is set", async () => {
    const originalModel = process.env.OPENAI_MODEL;
    process.env.OPENAI_MODEL = "gpt-5";

    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createValidAssessment()),
          },
        },
      ],
    }));

    try {
      await enrichCampaignFitWithOpenAi({
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
        model: "gpt-4.1-mini",
      }),
    );
  });

  it("always uses gpt-4.1-mini for campaign fit assessment requests", async () => {
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createValidAssessment()),
          },
        },
      ],
    }));

    await enrichCampaignFitWithOpenAi({
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
        model: "gpt-4.1-mini",
      }),
    );
  });

  it("omits temperature from the request body", async () => {
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createValidAssessment()),
          },
        },
      ],
    }));

    await enrichCampaignFitWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create,
          },
        },
      },
    });

    const request = create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(request).toBeDefined();
    expect(request).not.toHaveProperty("temperature");
  });

  it("uses json_object response formatting", async () => {
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createValidAssessment()),
          },
        },
      ],
    }));

    await enrichCampaignFitWithOpenAi({
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
        response_format: {
          type: "json_object",
        },
      }),
    );
  });

  it("passes the campaign manager free-text brief into the mini prompt", async () => {
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createValidAssessment()),
          },
        },
      ],
    }));

    await enrichCampaignFitWithOpenAi({
      ...TEST_INPUT,
      campaignBrief: {
        ...TEST_INPUT.campaignBrief,
        campaignObjective: "Find cozy strategy gaming creators with German-speaking PC audiences.",
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
      | { messages?: Array<{ role: string; content: string }> }
      | undefined;
    const userMessage = request?.messages?.find((message) => message.role === "user");

    expect(userMessage).toBeDefined();
    expect(JSON.parse(userMessage?.content ?? "{}")).toEqual(
      expect.objectContaining({
        freeTextBrief: "Find cozy strategy gaming creators with German-speaking PC audiences.",
        briefUsage: expect.stringContaining("primary campaign-specific relevance signal"),
      }),
    );
  });

  it("instructs Mini to return short card-ready rationale", async () => {
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createValidAssessment()),
          },
        },
      ],
    }));

    await enrichCampaignFitWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create,
          },
        },
      },
    });

    const request = create.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: string }> }
      | undefined;
    const systemMessage = request?.messages?.find((message) => message.role === "system");
    const userMessage = request?.messages?.find((message) => message.role === "user");
    const prompt = JSON.parse(userMessage?.content ?? "{}") as {
      instructions?: {
        brevity?: string;
        fitReasons?: string;
        fitConcerns?: string;
        recommendedAngles?: string;
        avoidTopics?: string;
      };
    };

    expect(systemMessage?.content).toContain("short signal bullets");
    expect(prompt.instructions?.brevity).toContain("under 80 characters");
    expect(prompt.instructions?.fitReasons).toContain("List every useful fit signal");
    expect(prompt.instructions?.fitReasons).toContain("Past sponsors: CarVertical, HelloFresh");
    expect(prompt.instructions?.fitConcerns).toContain("Return an empty array");
    expect(prompt.instructions?.recommendedAngles).toContain("Return an empty array");
    expect(prompt.instructions?.avoidTopics).toContain("Return an empty array");
  });

  it("parses valid assessment output", async () => {
    const result = await enrichCampaignFitWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create: async () => ({
              id: "resp-1",
              choices: [
                {
                  message: {
                    content: JSON.stringify(createValidAssessment()),
                  },
                },
              ],
            }),
          },
        },
      },
    });

    expect(result.profile).toEqual({
      ...createValidAssessment(),
      fitConcerns: [],
      recommendedAngles: [],
      avoidTopics: [],
    });
    expect(result.rawPayload.id).toBe("resp-1");
    expect(result.model).toBe("gpt-4.1-mini");
  });

  it("rejects fitScore values greater than 1", async () => {
    await expect(
      enrichCampaignFitWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create: async () => ({
                choices: [
                  {
                    message: {
                      content: JSON.stringify(
                        createValidAssessment({
                          fitScore: 1.5,
                        }),
                      ),
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
      } satisfies Partial<OpenAiCampaignFitError>),
    );
  });

  it("rejects fitScore values below 0", async () => {
    await expect(
      enrichCampaignFitWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create: async () => ({
                choices: [
                  {
                    message: {
                      content: JSON.stringify(
                        createValidAssessment({
                          fitScore: -0.1,
                        }),
                      ),
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
      } satisfies Partial<OpenAiCampaignFitError>),
    );
  });

  it("rejects empty fitReasons arrays", async () => {
    await expect(
      enrichCampaignFitWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create: async () => ({
                choices: [
                  {
                    message: {
                      content: JSON.stringify(
                        createValidAssessment({
                          fitReasons: [],
                        }),
                      ),
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
      } satisfies Partial<OpenAiCampaignFitError>),
    );
  });

  it("compacts verbose assessment output before returning it", async () => {
    const result = await enrichCampaignFitWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify(
                      createValidAssessment({
                        fitReasons: [
                          "Audience aligns with the brief.",
                          "Review format matches the campaign.",
                          "Hardware topics recur.",
                          "Past sponsors: CarVertical, HelloFresh.",
                        ],
                        fitConcerns: [
                          "Limited local-language reach.",
                          "Some console-only content.",
                          "This third concern is too much.",
                        ],
                        recommendedAngles: [
                          "Benchmark-style review.",
                          "This second angle is too much.",
                        ],
                        avoidTopics: [
                          "Console-only positioning.",
                          "This second avoid topic is too much.",
                        ],
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

    expect(result.profile.fitReasons).toHaveLength(4);
    expect(result.profile.fitReasons).toContain("Past sponsors: CarVertical, HelloFresh.");
    expect(result.profile.fitConcerns).toEqual([]);
    expect(result.profile.recommendedAngles).toEqual([]);
    expect(result.profile.avoidTopics).toEqual([]);
  });

  it("compacts long assessment bullets before returning them", async () => {
    const result = await enrichCampaignFitWithOpenAi({
      ...TEST_INPUT,
      client: {
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify(
                      createValidAssessment({
                        fitReasons: [
                          "This sentence is intentionally far too long for the scouting result card because it reads like a report paragraph instead of a compact bullet.",
                        ],
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

    expect(result.profile.fitReasons[0]?.length).toBeLessThanOrEqual(80);
    expect(result.profile.fitReasons[0]).toBe(
      "This sentence is intentionally far too long for the scouting result card...",
    );
  });

  it("maps 401 responses to OPENAI_AUTH_FAILED", async () => {
    await expect(
      enrichCampaignFitWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create: async () => {
                const error = new Error("bad auth") as Error & { status: number };
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
        message: "bad auth",
      } satisfies Partial<OpenAiCampaignFitError>),
    );
  });

  it("maps 429 responses to OPENAI_RATE_LIMITED", async () => {
    await expect(
      enrichCampaignFitWithOpenAi({
        ...TEST_INPUT,
        client: {
          chat: {
            completions: {
              create: async () => {
                const error = new Error("slow down") as Error & { status: number };
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
        message: "slow down",
      } satisfies Partial<OpenAiCampaignFitError>),
    );
  });

  it("throws OPENAI_API_KEY_MISSING when no API key is provided", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      await expect(
        enrichCampaignFitWithOpenAi({
          ...TEST_INPUT,
          apiKey: undefined,
          client: {
            chat: {
              completions: {
                create: async () => ({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify(createValidAssessment()),
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
          code: "OPENAI_API_KEY_MISSING",
          status: 500,
        } satisfies Partial<OpenAiCampaignFitError>),
      );
    } finally {
      if (originalKey !== undefined) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    }
  });

  it("JSON-encodes the campaign brief into the user prompt", async () => {
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createValidAssessment()),
          },
        },
      ],
    }));

    await enrichCampaignFitWithOpenAi({
      ...TEST_INPUT,
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
    const parsed = JSON.parse(content as string) as {
      campaignBrief: {
        campaignObjective: string | null;
      };
    };

    expect(parsed.campaignBrief.campaignObjective).toBe(
      "Drive awareness for a new GPU launch",
    );
  });

  it("slims the youtube context to five videos with descriptions capped at 200 characters", async () => {
    const longDescription = "x".repeat(260);
    const create = vi.fn<
      (input: Record<string, unknown>) => Promise<{ choices: Array<{ message: { content: string } }> }>
    >(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify(createValidAssessment()),
          },
        },
      ],
    }));

    await enrichCampaignFitWithOpenAi({
      ...TEST_INPUT,
      youtubeContext: {
        ...TEST_INPUT.youtubeContext,
        recentVideos: Array.from({ length: 10 }, (_, index) => ({
          youtubeVideoId: `video-${index + 1}`,
          title: `Video ${index + 1}`,
          description: index === 0 ? longDescription : `Description ${index + 1}`,
          publishedAt: "2024-01-01T00:00:00Z",
          viewCount: index + 100,
          likeCount: index + 10,
          commentCount: index + 1,
          durationSeconds: 300,
          isShort: false,
          categoryId: "20",
          categoryName: "Gaming",
          tags: [],
        })),
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
    const parsed = JSON.parse(content as string) as {
      youtubeContext: {
        recentVideos: Array<{
          description: string | null;
        }>;
      };
    };

    expect(parsed.youtubeContext.recentVideos).toHaveLength(5);
    expect(parsed.youtubeContext.recentVideos[0]?.description?.length).toBeLessThanOrEqual(200);
  });
});
