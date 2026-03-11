import {
  csvImportBatchSummarySchema,
  csvImportUploadFileSchema,
  listCsvImportBatchesResponseSchema,
} from "@scouting-platform/contracts";
import { createCsvImportBatch, listCsvImportBatches } from "@scouting-platform/core";
import { NextResponse } from "next/server";

import { requireAdminSession, toRouteErrorResponse } from "../../../../lib/api";

export async function GET(): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const items = await listCsvImportBatches();
    const payload = listCsvImportBatchesResponseSchema.parse({ items });
    return NextResponse.json(payload);
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const admin = await requireAdminSession();

  if (!admin.ok) {
    return admin.response;
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
    }

    const parsedFile = csvImportUploadFileSchema.safeParse({
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });

    if (!parsedFile.success) {
      return NextResponse.json(
        {
          error: "Invalid request payload",
          details: parsedFile.error.flatten(),
        },
        { status: 400 },
      );
    }

    const batch = await createCsvImportBatch({
      requestedByUserId: admin.userId,
      fileName: parsedFile.data.fileName,
      fileSize: parsedFile.data.fileSize,
      csvText: await file.text(),
    });
    const payload = csvImportBatchSummarySchema.parse(batch);

    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
