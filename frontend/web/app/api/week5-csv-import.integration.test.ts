import { PrismaClient, Role } from "@prisma/client";
import {
  CSV_IMPORT_FILE_SIZE_LIMIT_BYTES,
  CSV_IMPORT_HEADER,
  CSV_IMPORT_LEGACY_V3_HEADER,
} from "@scouting-platform/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.DATABASE_URL_TEST?.trim() ?? "";
const integration = databaseUrl ? describe.sequential : describe.skip;

type SessionUser = { id: string; role: "admin" | "user" } | null;

let currentSessionUser: SessionUser = null;

vi.mock("../../auth", () => ({
  auth: vi.fn(async () => (currentSessionUser ? { user: currentSessionUser } : null)),
}));

integration("week 5 csv import API integration", () => {
  let prisma: PrismaClient;
  let batchesRoute: typeof import("./admin/csv-import-batches/route");
  let batchDetailRoute: typeof import("./admin/csv-import-batches/[id]/route");
  let core: typeof import("@scouting-platform/core");

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "week5-csv-import-api-auth-secret";

    const db = await import("@scouting-platform/db");
    prisma = db.createPrismaClient({ databaseUrl });

    await prisma.$connect();
    core = await import("@scouting-platform/core");
    batchesRoute = await import("./admin/csv-import-batches/route");
    batchDetailRoute = await import("./admin/csv-import-batches/[id]/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        dropdown_values,
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

    await prisma.$executeRawUnsafe(`
      DELETE FROM pgboss.job WHERE name = 'imports.csv.process'
    `);
  });

  afterAll(async () => {
    await core.stopCsvImportsQueue();
    await prisma.$disconnect();
  });

  async function createUser(email: string, role: Role = Role.ADMIN): Promise<{ id: string }> {
    return prisma.user.create({
      data: {
        email,
        name: role === Role.ADMIN ? "Admin" : "User",
        role,
        passwordHash: "hash",
        isActive: true,
      },
      select: {
        id: true,
      },
    });
  }

  function makeCsvFile(
    csvText: string,
    options?: { name?: string; type?: string },
  ): File {
    return new File([csvText], options?.name ?? "contacts.csv", {
      type: options?.type ?? "text/csv",
    });
  }

  function makeFormData(file: File | string): FormData {
    const formData = new FormData();
    formData.append("file", file);
    return formData;
  }

  function creatorListRow(values: string[]): string {
    if (values.length === CSV_IMPORT_HEADER.length) {
      return values.join(",");
    }

    const valueByLegacyHeader = new Map<string, string>();
    CSV_IMPORT_LEGACY_V3_HEADER.forEach((header, index) => {
      valueByLegacyHeader.set(header, values[index] ?? "");
    });

    const row = CSV_IMPORT_HEADER.map((header) => valueByLegacyHeader.get(header) ?? "");

    return row
      .map((value) => {
        if (/[",\n\r]/.test(value)) {
          return `"${value.replace(/"/g, "\"\"")}"`;
        }

        return value;
      })
      .join(",");
  }

  function makeCreatorListCsv(rows: string[]): string {
    return [
      CSV_IMPORT_HEADER.join(","),
      ...rows,
    ].join("\n");
  }

  function makeDeprecatedYoutubeAverageHeader(): string {
    const header: string[] = [...CSV_IMPORT_HEADER];
    const insertIndex = header.indexOf("YouTube Video Median Views");

    if (insertIndex === -1) {
      throw new Error("YouTube Video Median Views header is missing");
    }

    header.splice(insertIndex, 0, "YouTube Average Views");
    return header.join(",");
  }

  async function seedSyncedDropdownValues(): Promise<void> {
    await prisma.dropdownValue.createMany({
      data: [
        { fieldKey: "INFLUENCER_TYPE", value: "Male" },
        { fieldKey: "INFLUENCER_VERTICAL", value: "Gaming" },
        { fieldKey: "COUNTRY_REGION", value: "Croatia" },
        { fieldKey: "LANGUAGE", value: "Croatian" },
      ],
    });
  }

  it("creates a batch via POST and returns list/detail responses for admins", async () => {
    const admin = await createUser("admin@example.com");
    currentSessionUser = { id: admin.id, role: "admin" };
    await seedSyncedDropdownValues();

    const uploadResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(
          makeCsvFile(
            makeCreatorListCsv([
              creatorListRow([
                "Creator One",
                "",
                "",
                "https://www.youtube.com/channel/UC-CSV-1",
                "Spring Campaign",
                "Owner",
                "",
                "creator@example.com",
                "",
                "EUR",
                "Paid",
                "Influencer",
                "April",
                "2026",
                "Client A",
                "Deal One",
                "Deal One",
                "Sales Pipeline",
                "Scouted",
                "",
                "",
                "Male",
                "Gaming",
                "Croatia",
                "Croatian",
                "@creatorone",
                "https://www.youtube.com/@creatorone",
                "22,000",
                "11,000",
                "2.10%",
                "1,000",
              ]),
              creatorListRow([
                "Creator Two",
                "",
                "",
                "https://www.youtube.com/channel/UC-CSV-2",
                "Spring Campaign",
                "Owner",
                "",
                "invalid-email",
                "",
                "EUR",
                "Paid",
                "Influencer",
                "April",
                "2026",
                "Client A",
                "Deal Two",
                "Deal Two",
                "Sales Pipeline",
                "Scouted",
                "",
                "",
                "Male",
                "Gaming",
                "Croatia",
                "Croatian",
                "@creatortwo",
                "https://www.youtube.com/@creatortwo",
                "31000",
                "16000",
                "3.0",
                "2000",
              ]),
            ]),
          ),
        ),
      }),
    );

    expect(uploadResponse.status).toBe(202);
    const uploadPayload = await uploadResponse.json();
    expect(uploadPayload.status).toBe("queued");
    expect(uploadPayload.templateVersion).toBe("v3");
    expect(uploadPayload.totalRowCount).toBe(2);
    expect(uploadPayload.failedRowCount).toBe(1);

    const listResponse = await batchesRoute.GET();
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.items).toHaveLength(1);
    expect(listPayload.items[0]?.id).toBe(uploadPayload.id);

    const detailResponse = await batchDetailRoute.GET(
      new Request(`http://localhost/api/admin/csv-import-batches/${uploadPayload.id}?page=1&pageSize=1`),
      { params: Promise.resolve({ id: uploadPayload.id }) },
    );
    expect(detailResponse.status).toBe(200);
    const detailPayload = await detailResponse.json();
    expect(detailPayload.rows).toHaveLength(1);
    expect(detailPayload.rows[0]?.rowNumber).toBe(2);
  });

  it("returns failed rows in batch detail without collapsing to a 500", async () => {
    const admin = await createUser("admin@example.com");
    currentSessionUser = { id: admin.id, role: "admin" };
    await seedSyncedDropdownValues();

    const uploadResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(
          makeCsvFile(
            makeCreatorListCsv([
              creatorListRow([
                "Creator One",
                "",
                "",
                "https://www.youtube.com/channel/UC-CSV-1",
                "Spring Campaign",
                "Owner",
                "",
                "creator@example.com",
                "",
                "EUR",
                "Paid",
                "Influencer",
                "April",
                "2026",
                "Client A",
                "Deal One",
                "Deal One",
                "Sales Pipeline",
                "Scouted",
                "",
                "",
                "Male",
                "Gaming",
                "Croatia",
                "Croatian",
                "@creatorone",
                "https://www.youtube.com/@creatorone",
                "22000",
                "11000",
                "2.1",
                "1000",
              ]),
              creatorListRow([
                "",
                "",
                "",
                "https://www.youtube.com/channel/UC-CSV-2",
                "Spring Campaign",
                "Owner",
                "",
                "invalid-email",
                "",
                "EUR",
                "Paid",
                "Influencer",
                "April",
                "2026",
                "Client A",
                "Deal Two",
                "Deal Two",
                "Sales Pipeline",
                "Scouted",
                "",
                "",
                "Unknown",
                "Gaming",
                "Croatia",
                "Croatian",
                "@creatortwo",
                "https://www.youtube.com/@creatortwo",
                "not-a-number",
                "9000",
                "2.0",
                "20x",
              ]),
            ]),
          ),
        ),
      }),
    );

    expect(uploadResponse.status).toBe(202);
    const uploadPayload = await uploadResponse.json();

    const detailResponse = await batchDetailRoute.GET(
      new Request(`http://localhost/api/admin/csv-import-batches/${uploadPayload.id}?page=1&pageSize=10`),
      { params: Promise.resolve({ id: uploadPayload.id }) },
    );

    expect(detailResponse.status).toBe(200);
    const detailPayload = await detailResponse.json();
    expect(detailPayload.rows).toHaveLength(2);
    expect(detailPayload.rows[1]?.status).toBe("failed");
    expect(detailPayload.rows[1]?.channelTitle).toBe("");
    expect(detailPayload.rows[1]?.contactEmail).toBe("invalid-email");
    expect(detailPayload.rows[1]?.youtubeFollowers).toBe("20x");
    expect(detailPayload.rows[1]?.influencerType).toBe("Unknown");
    expect(detailPayload.rows[1]?.errorMessage).toContain("Channel Name is required");
    expect(detailPayload.rows[1]?.errorMessage).toContain("Email is invalid");
    expect(detailPayload.rows[1]?.errorMessage).toContain("YouTube Video Median Views is invalid");
    expect(detailPayload.rows[1]?.errorMessage).toContain("YouTube Followers is invalid");
    expect(detailPayload.rows[1]?.errorMessage).toContain(
      "Influencer Type must use a saved HubSpot dropdown value",
    );
  });

  it("enforces admin-only access on csv import routes", async () => {
    const admin = await createUser("admin@example.com");
    const user = await createUser("user@example.com", Role.USER);

    currentSessionUser = null;
    const unauthenticated = await batchesRoute.GET();
    expect(unauthenticated.status).toBe(401);

    currentSessionUser = { id: user.id, role: "user" };
    const forbidden = await batchesRoute.GET();
    expect(forbidden.status).toBe(403);

    currentSessionUser = { id: admin.id, role: "admin" };
    const allowed = await batchesRoute.GET();
    expect(allowed.status).toBe(200);
  });

  it("returns 400 for missing file or strict-template header mismatch", async () => {
    const admin = await createUser("admin@example.com");
    currentSessionUser = { id: admin.id, role: "admin" };

    const missingFileResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: new FormData(),
      }),
    );
    expect(missingFileResponse.status).toBe(400);

    const invalidHeaderResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(makeCsvFile([
          "youtubeChannelId,channelTitle,contactEmail",
          "UC-CSV-1,Creator One,creator@example.com",
        ].join("\n"), { name: "invalid.csv" })),
      }),
    );
    expect(invalidHeaderResponse.status).toBe(400);

    const deprecatedHeaderResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(
          makeCsvFile(
            [
              makeDeprecatedYoutubeAverageHeader(),
              Array.from({ length: CSV_IMPORT_HEADER.length + 1 }, (_, index) => (index === 0 ? "Creator One" : "")).join(","),
            ].join("\n"),
            { name: "deprecated-average.csv" },
          ),
        ),
      }),
    );
    expect(deprecatedHeaderResponse.status).toBe(400);
    expect(await deprecatedHeaderResponse.json()).toEqual({
      error: "YouTube Average Views is no longer supported. Use YouTube Video Median Views.",
    });
  });

  it("returns 400 for non-file multipart values and invalid file metadata", async () => {
    const admin = await createUser("admin@example.com");
    currentSessionUser = { id: admin.id, role: "admin" };

    const nonFileResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData("not-a-file"),
      }),
    );
    expect(nonFileResponse.status).toBe(400);
    expect(await nonFileResponse.json()).toEqual({
      error: "CSV file is required",
    });

    const invalidExtensionResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(
          makeCsvFile("youtubeChannelId,channelTitle\nUC-CSV-1,Creator One", {
            name: "contacts.txt",
          }),
        ),
      }),
    );
    expect(invalidExtensionResponse.status).toBe(400);
    const invalidExtensionPayload = await invalidExtensionResponse.json();
    expect(invalidExtensionPayload.error).toBe("Invalid request payload");
    expect(invalidExtensionPayload.details.fieldErrors.fileName).toContain(
      "File name must end with .csv",
    );

    const invalidMimeResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(
          makeCsvFile("youtubeChannelId,channelTitle\nUC-CSV-1,Creator One", {
            type: "application/json",
          }),
        ),
      }),
    );
    expect(invalidMimeResponse.status).toBe(400);
    const invalidMimePayload = await invalidMimeResponse.json();
    expect(invalidMimePayload.error).toBe("Invalid request payload");
    expect(invalidMimePayload.details.fieldErrors.mimeType).toContain(
      "File must be a CSV upload",
    );

    const oversizedFileResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(
          new File([new Uint8Array(CSV_IMPORT_FILE_SIZE_LIMIT_BYTES + 1)], "contacts.csv", {
            type: "text/csv",
          }),
        ),
      }),
    );
    expect(oversizedFileResponse.status).toBe(400);
    const oversizedFilePayload = await oversizedFileResponse.json();
    expect(oversizedFilePayload.error).toBe("Invalid request payload");
    expect(oversizedFilePayload.details.fieldErrors.fileSize).toBeDefined();

    const batchCount = await prisma.csvImportBatch.count();
    expect(batchCount).toBe(0);
  });

  it("returns 400 when HubSpot-synced dropdown values have not been configured yet", async () => {
    const admin = await createUser("admin@example.com");
    currentSessionUser = { id: admin.id, role: "admin" };

    const response = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(
          makeCsvFile(
            makeCreatorListCsv([
              creatorListRow([
                "Creator One",
                "",
                "",
                "https://www.youtube.com/channel/UC-CSV-1",
                "Spring Campaign",
                "Owner",
                "",
                "creator@example.com",
                "",
                "EUR",
                "Paid",
                "Influencer",
                "April",
                "2026",
                "Client A",
                "Deal One",
                "Deal One",
                "Sales Pipeline",
                "Scouted",
                "",
                "",
                "Male",
                "Gaming",
                "Croatia",
                "Croatian",
                "@creatorone",
                "https://www.youtube.com/@creatorone",
                "22000",
                "11000",
                "2.1",
                "1000",
              ]),
            ]),
          ),
        ),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "HubSpot dropdown values are not configured. Sync dropdown values from HubSpot before importing CSV.",
    });
  });
});
