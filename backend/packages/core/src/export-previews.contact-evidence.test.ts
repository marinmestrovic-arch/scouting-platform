import { describe, expect, it } from "vitest";

import {
  extractHighConfidencePhoneNumbersFromText,
  extractHighConfidencePhoneNumbersFromTextList,
} from "./export-previews";

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
