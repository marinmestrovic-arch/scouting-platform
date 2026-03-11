import { describe, expect, it } from "vitest";

import { buildHubspotContactProperties } from "./index";

describe("buildHubspotContactProperties", () => {
  it("maps resolved channel data into stable contact properties", () => {
    const properties = buildHubspotContactProperties({
      id: "11111111-1111-4111-8111-111111111111",
      youtubeChannelId: "UC-HUB-1",
      title: "Creator",
      handle: "@creator",
      contacts: [{ email: "creator@example.com" }],
      metrics: {
        subscriberCount: 1500n,
        viewCount: 12000n,
        videoCount: 48n,
      },
      enrichment: {
        summary: "Gaming creator",
        topics: ["gaming", "pc"],
        brandFitNotes: "Good fit",
      },
    });

    expect(properties).toMatchObject({
      email: "creator@example.com",
      youtube_channel_id: "UC-HUB-1",
      creator_title: "Creator",
      creator_handle: "@creator",
      enrichment_topics: "gaming;pc",
    });
  });
});
