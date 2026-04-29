import { describe, expect, it, vi } from "vitest";

import { enrichCreatorProfilesWithOpenAi } from "./creator-profile-enrichment";

const DROPDOWN_OPTIONS = {
  "Influencer Type": ["Creator", "Streamer"],
  "Influencer Vertical": ["Gaming", "Beauty", "Tech"],
  "Country/Region": ["United States", "Croatia"],
  Language: ["English", "Croatian"],
};

function responseText(body: unknown) {
  return {
    output_text: JSON.stringify(body),
  };
}

function chatText(body: unknown) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(body),
        },
      },
    ],
  };
}

describe("enrichCreatorProfilesWithOpenAi", () => {
  it("uses strict Responses API output and retries blank dropdown classifications", async () => {
    const responsesCreate = vi
      .fn()
      .mockResolvedValueOnce(
        responseText({
          rows: [
            {
              row_key: "row-1",
              "First Name": "Alex",
              "Last Name": "Creator",
              Email: "alex@example.com",
              "Influencer Type": "",
              "Influencer Vertical": [],
              "Country/Region": "",
              Language: "",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        responseText({
          rows: [
            {
              row_key: "row-1",
              "First Name": "",
              "Last Name": "",
              "Influencer Type": "Creator",
              "Influencer Vertical": ["Gaming", "Tech"],
              "Country/Region": "United States",
              Language: "English",
            },
          ],
        }),
      );
    const chatCreate = vi.fn();

    const results = await enrichCreatorProfilesWithOpenAi({
      apiKey: "openai-key",
      client: {
        responses: {
          create: responsesCreate,
        },
        chat: {
          completions: {
            create: chatCreate,
          },
        },
      },
      requests: [
        {
          rowKey: "row-1",
          channelName: "Alex Creator",
          channelUrl: "https://youtube.com/@alex",
          campaignName: "Spring",
          requestedFields: [
            "First Name",
            "Last Name",
            "Email",
            "Influencer Type",
            "Influencer Vertical",
            "Country/Region",
            "Language",
          ],
          contextText: "Gaming and tech creator in the United States. Email alex@example.com.",
        },
      ],
      dropdownOptions: DROPDOWN_OPTIONS,
    });

    expect(chatCreate).not.toHaveBeenCalled();
    expect(responsesCreate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(responsesCreate.mock.calls[0]?.[0])).not.toContain("Phone Number");
    expect(JSON.stringify(responsesCreate.mock.calls[0]?.[0])).toContain("\"Email\"");
    expect(results[0]?.values).toMatchObject({
      "First Name": "Alex",
      "Last Name": "Creator",
      Email: "alex@example.com",
      "Influencer Type": "Creator",
      "Influencer Vertical": "Gaming; Tech",
      "Country/Region": "United States",
      Language: "English",
    });
  });

  it("falls back to chat completions when Responses API is unavailable", async () => {
    const responsesCreate = vi.fn().mockRejectedValueOnce(new Error("unsupported"));
    const chatCreate = vi.fn().mockResolvedValueOnce(
      chatText({
        rows: [
          {
            row_key: "row-1",
            "First Name": "Ana",
            "Last Name": "Creator",
            Email: "",
            "Influencer Type": "Creator",
            "Influencer Vertical": ["Beauty"],
            "Country/Region": "Croatia",
            Language: "Croatian",
          },
        ],
      }),
    );

    const results = await enrichCreatorProfilesWithOpenAi({
      apiKey: "openai-key",
      client: {
        responses: {
          create: responsesCreate,
        },
        chat: {
          completions: {
            create: chatCreate,
          },
        },
      },
      requests: [
        {
          rowKey: "row-1",
          channelName: "Ana Creator",
          channelUrl: "https://youtube.com/@ana",
          campaignName: "Spring",
          requestedFields: ["First Name", "Last Name", "Influencer Vertical"],
          contextText: "Beauty creator in Croatia.",
        },
      ],
      dropdownOptions: DROPDOWN_OPTIONS,
    });

    expect(responsesCreate).toHaveBeenCalledTimes(1);
    expect(chatCreate).toHaveBeenCalledTimes(1);
    expect(results[0]?.values).not.toHaveProperty("Phone Number");
    expect(results[0]?.values.Email).toBe("");
    expect(results[0]?.values["Influencer Vertical"]).toBe("Beauty");
  });
});
