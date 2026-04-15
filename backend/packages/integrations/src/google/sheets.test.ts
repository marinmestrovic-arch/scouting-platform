import { generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GoogleSheetsError,
  appendGoogleSheetsRows,
  copyGoogleSheetRowFormat,
  ensureGoogleSheetRowCapacity,
  extractGoogleSpreadsheetId,
  getGoogleSheetProperties,
  getGoogleSheetsAccessToken,
  readGoogleSheetsHeaderRow,
  readGoogleSheetsRows,
  writeGoogleSheetsRows,
} from "./sheets";

function createPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  return privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
}

describe("google sheets adapter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("extracts spreadsheet ids from either a URL or a raw id", () => {
    expect(
      extractGoogleSpreadsheetId(
        "https://docs.google.com/spreadsheets/d/abc123-XYZ_456/edit#gid=0",
      ),
    ).toBe("abc123-XYZ_456");
    expect(extractGoogleSpreadsheetId("abc123-XYZ_456")).toBe("abc123-XYZ_456");
    expect(extractGoogleSpreadsheetId("not a spreadsheet")).toBeNull();
  });

  it("requests an access token with a signed JWT", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;

      return new Response(JSON.stringify({ access_token: "google-token" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const token = await getGoogleSheetsAccessToken({
      clientEmail: "service-account@example.iam.gserviceaccount.com",
      privateKey: createPrivateKey(),
      fetchFn,
    });

    expect(token).toBe("google-token");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]?.[0] ?? "")).toBe("https://oauth2.googleapis.com/token");
  });

  it("names the required environment variables when credentials are missing", async () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "");

    await expect(getGoogleSheetsAccessToken()).rejects.toMatchObject({
      code: "GOOGLE_SHEETS_CREDENTIALS_MISSING",
      status: 500,
      message:
        "Google Sheets service account credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.",
    } satisfies Partial<GoogleSheetsError>);
  });

  it("reads and trims the sheet header row", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;

      return new Response(JSON.stringify({ values: [[" Channel Name ", "Email", "Year "]] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const headerRow = await readGoogleSheetsHeaderRow({
      spreadsheetId: "spreadsheet-1",
      sheetName: "Scouting Export",
      accessToken: "google-token",
      fetchFn,
    });

    expect(headerRow).toEqual(["Channel Name", "Email", "Year"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("reads candidate import rows from the configured start row and header width", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;

      return new Response(JSON.stringify({ values: [[" Contacting "], [], [" Creator A "]] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const rows = await readGoogleSheetsRows({
      spreadsheetId: "spreadsheet-1",
      sheetName: "Scouting Export",
      startRowNumber: 3,
      columnCount: 30,
      accessToken: "google-token",
      fetchFn,
    });

    expect(rows).toEqual([["Contacting"], [], ["Creator A"]]);
    expect(decodeURIComponent(String(fetchFn.mock.calls[0]?.[0] ?? ""))).toContain(
      "'Scouting Export'!A3:AD",
    );
  });

  it("resolves sheet metadata for format-copy operations", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;

      return new Response(
        JSON.stringify({
          sheets: [
            {
              properties: {
                sheetId: 123,
                title: "Archive",
                gridProperties: {
                  rowCount: 200,
                  columnCount: 20,
                },
              },
            },
            {
              properties: {
                sheetId: 456,
                title: "Scouting Export",
                gridProperties: {
                  rowCount: 1000,
                  columnCount: 30,
                },
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    await expect(
      getGoogleSheetProperties({
        spreadsheetId: "spreadsheet-1",
        sheetName: "Scouting Export",
        accessToken: "google-token",
        fetchFn,
      }),
    ).resolves.toEqual({
      sheetId: 456,
      title: "Scouting Export",
      rowCount: 1000,
      columnCount: 30,
    });
  });

  it("copies the first empty row format to additional imported rows", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await copyGoogleSheetRowFormat({
      spreadsheetId: "spreadsheet-1",
      sheetId: 456,
      sourceRowNumber: 4,
      targetStartRowNumber: 5,
      rowCount: 2,
      columnCount: 30,
      accessToken: "google-token",
      fetchFn,
    });

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body ?? "{}")) as {
      requests: Array<{
        copyPaste: {
          source: { startRowIndex: number; endRowIndex: number; endColumnIndex: number };
          destination: { startRowIndex: number; endRowIndex: number; endColumnIndex: number };
          pasteType: string;
        };
      }>;
    };

    expect(body.requests[0]?.copyPaste).toMatchObject({
      source: {
        startRowIndex: 3,
        endRowIndex: 4,
        endColumnIndex: 30,
      },
      destination: {
        startRowIndex: 4,
        endRowIndex: 6,
        endColumnIndex: 30,
      },
      pasteType: "PASTE_FORMAT",
    });
  });

  it("extends the sheet row capacity only when the target range exceeds the current grid", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await ensureGoogleSheetRowCapacity({
      spreadsheetId: "spreadsheet-1",
      sheetId: 456,
      currentRowCount: 4,
      requiredRowCount: 6,
      accessToken: "google-token",
      fetchFn,
    });

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body ?? "{}")) as {
      requests: Array<{
        appendDimension: {
          sheetId: number;
          dimension: string;
          length: number;
        };
      }>;
    };

    expect(body.requests[0]?.appendDimension).toEqual({
      sheetId: 456,
      dimension: "ROWS",
      length: 2,
    });

    await ensureGoogleSheetRowCapacity({
      spreadsheetId: "spreadsheet-1",
      sheetId: 456,
      currentRowCount: 6,
      requiredRowCount: 6,
      accessToken: "google-token",
      fetchFn,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("writes rows to the first empty row without inserting new rows", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;

      return new Response(
        JSON.stringify({
          updates: {
            updatedRange: "'Scouting Export'!A4:C5",
            updatedRows: 2,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const result = await writeGoogleSheetsRows({
      spreadsheetId: "spreadsheet-1",
      sheetName: "Scouting Export",
      startRowNumber: 4,
      accessToken: "google-token",
      rows: [
        ["Creator A", "a@example.com", "2026"],
        ["Creator B", "b@example.com", "2026"],
      ],
      fetchFn,
    });

    const requestInit = fetchFn.mock.calls[0]?.[1];

    expect(result).toEqual({
      updatedRange: "'Scouting Export'!A4:C5",
      updatedRows: 2,
    });
    expect(requestInit?.method).toBe("PUT");
    expect(decodeURIComponent(String(fetchFn.mock.calls[0]?.[0] ?? ""))).toContain(
      "'Scouting Export'!A4:C5",
    );
  });

  it("appends rows and returns the normalized update metadata", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;

      return new Response(
        JSON.stringify({
          updates: {
            updatedRange: "'Scouting Export'!A2:C3",
            updatedRows: 2,
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const result = await appendGoogleSheetsRows({
      spreadsheetId: "spreadsheet-1",
      sheetName: "Scouting Export",
      accessToken: "google-token",
      rows: [
        ["Creator A", "a@example.com", "2026"],
        ["Creator B", "b@example.com", "2026"],
      ],
      fetchFn,
    });

    expect(result).toEqual({
      updatedRange: "'Scouting Export'!A2:C3",
      updatedRows: 2,
    });
  });

  it("normalizes forbidden sheet access errors", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;

      return new Response(
        JSON.stringify({
          error: {
            message: "The caller does not have permission",
          },
        }),
        {
          status: 403,
          headers: { "content-type": "application/json" },
        },
      );
    });

    await expect(
      readGoogleSheetsHeaderRow({
        spreadsheetId: "spreadsheet-1",
        sheetName: "Scouting Export",
        accessToken: "google-token",
        fetchFn,
      }),
    ).rejects.toMatchObject({
      code: "GOOGLE_SHEETS_FORBIDDEN",
      status: 403,
    } satisfies Partial<GoogleSheetsError>);
  });
});
