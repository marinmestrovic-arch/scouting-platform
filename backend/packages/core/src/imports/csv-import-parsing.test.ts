import { CSV_IMPORT_MAX_DATA_ROWS } from "@scouting-platform/contracts";
import { describe, expect, it } from "vitest";

import { createCsvImportBatch } from "./index";

const TEST_USER_ID = "6fcbcf96-bca7-4bf1-b8ef-71f20f0f703b";

describe("csv import parsing", () => {
  it("accepts YouTube Channel Link as a URL-only header before enforcing row limits", async () => {
    const rows = Array.from(
      { length: CSV_IMPORT_MAX_DATA_ROWS + 1 },
      (_, index) => `https://www.youtube.com/channel/UCcsvparsing${String(index).padStart(12, "0")}`,
    );

    await expect(
      createCsvImportBatch({
        requestedByUserId: TEST_USER_ID,
        fileName: "youtube-links.csv",
        fileSize: 512,
        csvText: [
          "youTube Channel Link",
          ...rows,
        ].join("\n"),
      }),
    ).rejects.toMatchObject({
      code: "CSV_IMPORT_TOO_MANY_ROWS",
      status: 413,
    });
  });
});
