import { PrismaClient, Role } from "@prisma/client";
import { CSV_IMPORT_FILE_SIZE_LIMIT_BYTES } from "@scouting-platform/contracts";
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

    prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });

    await prisma.$connect();
    core = await import("@scouting-platform/core");
    batchesRoute = await import("./admin/csv-import-batches/route");
    batchDetailRoute = await import("./admin/csv-import-batches/[id]/route");
  });

  beforeEach(async () => {
    currentSessionUser = null;

    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
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

  it("creates a batch via POST and returns list/detail responses for admins", async () => {
    const admin = await createUser("admin@example.com");
    currentSessionUser = { id: admin.id, role: "admin" };

    const uploadResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(makeCsvFile([
          "youtubeChannelId,channelTitle,contactEmail,firstName,lastName,subscriberCount,viewCount,videoCount,notes,sourceLabel",
          "UC-CSV-1,Creator One,creator@example.com,,,1000,20000,50,Top creator,ops",
          "UC-CSV-2,Creator Two,invalid-email,,,2000,30000,60,,ops",
        ].join("\n"))),
      }),
    );

    expect(uploadResponse.status).toBe(202);
    const uploadPayload = await uploadResponse.json();
    expect(uploadPayload.status).toBe("queued");
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

    const uploadResponse = await batchesRoute.POST(
      new Request("http://localhost/api/admin/csv-import-batches", {
        method: "POST",
        body: makeFormData(makeCsvFile([
          "youtubeChannelId,channelTitle,contactEmail,firstName,lastName,subscriberCount,viewCount,videoCount,notes,sourceLabel",
          "UC-CSV-1,Creator One,creator@example.com,,,1000,20000,50,Top creator,ops",
          "UC-CSV-2,,invalid-email,,,20x,30000,60,,ops",
        ].join("\n"))),
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
    expect(detailPayload.rows[1]?.subscriberCount).toBe("20x");
    expect(detailPayload.rows[1]?.errorMessage).toContain("channelTitle is required");
    expect(detailPayload.rows[1]?.errorMessage).toContain("contactEmail is invalid");
    expect(detailPayload.rows[1]?.errorMessage).toContain("subscriberCount is invalid");
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
});
