import { generateKeyPairSync } from "node:crypto";

import { PrismaClient, Role, RunMonth, RunResultSource } from "@prisma/client";
import { CREATOR_LIST_HUBSPOT_HANDOFF_HEADER } from "@scouting-platform/contracts";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

function createPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  return privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;
}

function getGoogleSheetsColumnName(columnNumber: number): string {
  let remaining = columnNumber;
  let columnName = "";

  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    remaining = Math.floor((remaining - modulo) / 26);
  }

  return columnName;
}

integration("google sheets export API integration", () => {
  let prisma: PrismaClient;
  let exportRoute: typeof import("./runs/[id]/google-sheets-export/route");
  const originalFetch = global.fetch;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET =
      process.env.AUTH_SECRET ?? "google-sheets-export-api-auth-secret";
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL =
      "service-account@example.iam.gserviceaccount.com";
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = createPrivateKey();

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
    exportRoute = await import("./runs/[id]/google-sheets-export/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;
    global.fetch = originalFetch;

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        dropdown_values,
        hubspot_import_batch_rows,
        hubspot_import_batches,
        hubspot_push_batch_rows,
        hubspot_push_batches,
        csv_export_batches,
        csv_import_rows,
        channel_metrics,
        channel_contacts,
        csv_import_batches,
        advanced_report_requests,
        channel_provider_payloads,
        channel_insights,
        channel_enrichments,
        channel_youtube_contexts,
        channel_manual_overrides,
        saved_segments,
        run_hubspot_row_overrides,
        run_results,
        run_requests,
        audit_events,
        user_provider_credentials,
        sessions,
        accounts,
        verification_tokens,
        channels,
        users
      RESTART IDENTITY CASCADE
    `);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await prisma.$disconnect();
  });

  async function createManager(): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email: "manager@example.com",
        name: "Manager",
        role: Role.USER,
        passwordHash: "hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  async function createPreparedRun(managerId: string): Promise<{ id: string }> {
    const channel = await prisma.channel.create({
      data: {
        youtubeChannelId: "UC-GOOGLE-SHEETS-1",
        title: "Sheets Creator",
        handle: "@sheetscreator",
        youtubeUrl: "https://youtube.com/@sheetscreator",
      },
      select: {
        id: true,
      },
    });

    await prisma.channelContact.create({
      data: {
        channelId: channel.id,
        email: "creator@example.com",
        firstName: "Sheets",
        lastName: "Creator",
      },
    });

    await prisma.channelMetric.create({
      data: {
        channelId: channel.id,
        youtubeEngagementRate: 3.8,
        youtubeFollowers: 120_000n,
      },
    });

    await prisma.channelYoutubeContext.create({
      data: {
        channelId: channel.id,
        context: {
          youtubeChannelId: "UC-GOOGLE-SHEETS-1",
          title: "Sheets Creator",
          handle: "@sheetscreator",
          description: "Gaming creator",
          thumbnailUrl: null,
          publishedAt: null,
          defaultLanguage: "en",
          subscriberCount: 120_000,
          viewCount: 250_000,
          videoCount: 10,
          recentVideos: [
            {
              youtubeVideoId: "video-1",
              title: "Long One",
              description: null,
              publishedAt: null,
              durationSeconds: 600,
              isShort: false,
              viewCount: 100_000,
              likeCount: 6_000,
              commentCount: 2_000,
              categoryId: null,
              categoryName: null,
              tags: [],
            },
            {
              youtubeVideoId: "video-2",
              title: "Long Two",
              description: null,
              publishedAt: null,
              durationSeconds: 480,
              isShort: false,
              viewCount: 200_000,
              likeCount: 10_000,
              commentCount: 2_000,
              categoryId: null,
              categoryName: null,
              tags: [],
            },
            {
              youtubeVideoId: "video-3",
              title: "Long Three",
              description: null,
              publishedAt: null,
              durationSeconds: 420,
              isShort: false,
              viewCount: 300_000,
              likeCount: 12_000,
              commentCount: 3_000,
              categoryId: null,
              categoryName: null,
              tags: [],
            },
            {
              youtubeVideoId: "video-4",
              title: "Short One",
              description: null,
              publishedAt: null,
              durationSeconds: 30,
              isShort: true,
              viewCount: 50_000,
              likeCount: 1_000,
              commentCount: 200,
              categoryId: null,
              categoryName: null,
              tags: [],
            },
            {
              youtubeVideoId: "video-5",
              title: "Short Two",
              description: null,
              publishedAt: null,
              durationSeconds: 45,
              isShort: true,
              viewCount: 150_000,
              likeCount: 2_000,
              commentCount: 250,
              categoryId: null,
              categoryName: null,
              tags: [],
            },
          ],
          diagnostics: {
            warnings: [],
          },
        },
        fetchedAt: new Date(),
        lastError: null,
      },
    });

    await prisma.channelEnrichment.create({
      data: {
        channelId: channel.id,
        status: "COMPLETED",
        requestedByUserId: managerId,
        requestedAt: new Date(),
        completedAt: new Date(),
        summary: "Gaming creator",
        topics: ["Gaming"],
        brandFitNotes: "Good fit",
      },
    });

    await prisma.channelInsight.create({
      data: {
        channelId: channel.id,
        audienceCountries: [
          { countryName: "Croatia", percentage: 40 },
          { countryName: "Germany", percentage: 30 },
        ],
      },
    });

    const run = await prisma.runRequest.create({
      data: {
        requestedByUserId: managerId,
        name: "Sheets Run",
        query: "gaming creators",
        campaignName: "Spring Campaign",
        client: "Client A",
        month: RunMonth.APRIL,
        year: 2026,
        dealOwner: "Ivan",
        dealName: "Sheets Creator - Spring Campaign",
        pipeline: "Main",
        dealStage: "Qualified",
        currency: "EUR",
        dealType: "Paid",
        activationType: "Integration",
        hubspotInfluencerType: "Creator",
        hubspotLanguage: "English",
        status: "COMPLETED",
        completedAt: new Date(),
      },
      select: {
        id: true,
      },
    });

    await prisma.runResult.create({
      data: {
        runRequestId: run.id,
        channelId: channel.id,
        rank: 1,
        source: RunResultSource.CATALOG,
      },
    });

    return run;
  }

  it("exports prepared HubSpot rows to the requested Google Sheet", async () => {
    const manager = await createManager();
    const run = await createPreparedRun(manager.id);
    currentSessionUser = { id: manager.id, role: "user" };
    const headerRow = [...CREATOR_LIST_HUBSPOT_HANDOFF_HEADER];
    const lastColumn = getGoogleSheetsColumnName(headerRow.length);
    const expectedReadRange = `'Scouting Export'!A3:${lastColumn}`;
    const expectedWriteRange = `'Scouting Export'!A4:${lastColumn}4`;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const decodedUrl = decodeURIComponent(url);

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "google-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (url.includes("/values/")) {
        if (init?.method === "PUT") {
          return new Response(
            JSON.stringify({
              updates: {
                updatedRange: expectedWriteRange,
                updatedRows: 1,
              },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        if (decodedUrl.includes(expectedReadRange)) {
          return new Response(
            JSON.stringify({
              values: [["Contacting"]],
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        return new Response(
          JSON.stringify({
            values: [headerRow],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url.includes("/v4/spreadsheets/spreadsheet-1")) {
        return new Response(
          JSON.stringify({
            sheets: [
              {
                properties: {
                  sheetId: 456,
                  title: "Scouting Export",
                  gridProperties: {
                    rowCount: 1000,
                    columnCount: headerRow.length,
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
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    global.fetch = fetchMock as typeof fetch;

    const response = await exportRoute.POST(
      new Request(`http://localhost/api/runs/${run.id}/google-sheets-export`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          spreadsheetIdOrUrl: "https://docs.google.com/spreadsheets/d/spreadsheet-1/edit",
          sheetName: "Scouting Export",
        }),
      }),
      { params: Promise.resolve({ id: run.id }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      spreadsheetId: "spreadsheet-1",
      sheetName: "Scouting Export",
      appendedRowCount: 1,
      matchedHeaderCount: headerRow.length,
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const writeCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    expect(writeCall).toBeDefined();
    const [writeUrl, writeInit] = writeCall as [RequestInfo | URL, RequestInit | undefined];
    expect(decodeURIComponent(String(writeUrl))).toContain(expectedWriteRange);
    expect(String(writeInit?.body ?? "")).toContain("Sheets Creator");
    expect(String(writeInit?.body ?? "")).toContain("Spring Campaign");
  });

  it("returns normalized auth and validation errors", async () => {
    const unauthenticatedResponse = await exportRoute.POST(
      new Request("http://localhost/api/runs/not-a-uuid/google-sheets-export", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          spreadsheetIdOrUrl: "spreadsheet-1",
          sheetName: "Scouting Export",
        }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(unauthenticatedResponse.status).toBe(401);

    const manager = await createManager();
    currentSessionUser = { id: manager.id, role: "user" };

    const invalidParamsResponse = await exportRoute.POST(
      new Request("http://localhost/api/runs/not-a-uuid/google-sheets-export", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          spreadsheetIdOrUrl: "spreadsheet-1",
          sheetName: "Scouting Export",
        }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(invalidParamsResponse.status).toBe(400);

    const run = await createPreparedRun(manager.id);

    const invalidBodyResponse = await exportRoute.POST(
      new Request(`http://localhost/api/runs/${run.id}/google-sheets-export`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          spreadsheetIdOrUrl: "",
        }),
      }),
      { params: Promise.resolve({ id: run.id }) },
    );
    expect(invalidBodyResponse.status).toBe(400);
  });

});
