import { describe, expect, it } from "vitest";

import {
  buildHubspotValidationIssues,
  extractHighConfidencePhoneNumbersFromText,
  extractHighConfidencePhoneNumbersFromTextList,
  HUBSPOT_COLUMNS,
} from "./export-previews";

describe("HubSpot preparation validation", () => {
  const requiredValues = {
    contactType: "Influencer",
    campaignName: "Campaign",
    month: "July",
    year: "2026",
    clientName: "Client",
    dealOwner: "owner@example.com",
    dealName: "@creator - Campaign",
    pipeline: "Sales Pipeline",
    dealStage: "Scouted",
  };

  it("keeps optional dropdowns out of the required column list", () => {
    const requiredKeys = HUBSPOT_COLUMNS
      .filter((column) => column.required)
      .map((column) => column.key);

    expect(requiredKeys).not.toEqual(expect.arrayContaining([
      "currency",
      "dealType",
      "activationType",
      "influencerType",
      "influencerVertical",
      "countryRegion",
      "language",
    ]));
  });

  it("reports one grouped issue when First Name, Last Name, and Email are all blank", () => {
    const issues = buildHubspotValidationIssues([{
      id: "row-1",
      rowKey: "row-1:0",
      channelId: "channel-1",
      channelTitle: "Creator",
      values: {
        ...requiredValues,
        firstName: "",
        lastName: "",
        email: "",
        currency: "",
        dealType: "",
        activationType: "",
        influencerType: "",
        influencerVertical: "",
        countryRegion: "",
        language: "",
      },
    }]);

    expect(issues).toEqual([{
      rowId: "row-1",
      columnKey: "contactIdentity",
      message: "At least one of First Name, Last Name, or Email is required",
    }]);
  });

  it("allows an email-only row while all optional dropdowns are blank", () => {
    expect(buildHubspotValidationIssues([{
      id: "row-1",
      rowKey: "row-1:0",
      channelId: "channel-1",
      channelTitle: "Creator",
      values: {
        ...requiredValues,
        firstName: "",
        lastName: "",
        email: "creator@example.com",
      },
    }])).toEqual([]);
  });
});

describe("Creator List contact evidence helpers", () => {
  it("does not treat row-style numeric values as phone numbers", () => {
    expect(
      extractHighConfidencePhoneNumbersFromTextList([
        "Campaign Year: 2026",
        "YouTube Video Median Views: 1250000",
        "YouTube Followers: 750000",
      ]),
    ).toEqual([]);
  });

  it("extracts phone numbers with explicit channel contact context", () => {
    expect(
      extractHighConfidencePhoneNumbersFromText(
        "For business inquiries contact us by WhatsApp 091 234 5678 or email.",
      ),
    ).toEqual(["091 234 5678"]);
  });

  it("extracts clear international phone numbers from channel evidence", () => {
    expect(
      extractHighConfidencePhoneNumbersFromText(
        "Management: +385 91 234 5678",
      ),
    ).toEqual(["+385 91 234 5678"]);
  });
});
