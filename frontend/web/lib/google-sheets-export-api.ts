import {
  exportRunToGoogleSheetsRequestSchema,
  exportRunToGoogleSheetsResponseSchema,
  type ExportRunToGoogleSheetsRequest,
  type ExportRunToGoogleSheetsResponse,
} from "@scouting-platform/contracts";

type ApiErrorBody = {
  error?: string;
};

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getApiErrorMessage(response: Response, payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    typeof (payload as ApiErrorBody).error === "string"
  ) {
    return (payload as ApiErrorBody).error as string;
  }

  if (response.status === 401 || response.status === 403) {
    return "You are not authorized to modify this run in Google Sheets.";
  }

  return fallback;
}

export async function exportRunToGoogleSheets(
  runId: string,
  input: ExportRunToGoogleSheetsRequest,
): Promise<ExportRunToGoogleSheetsResponse> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/google-sheets-export`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(exportRunToGoogleSheetsRequestSchema.parse(input)),
  });
  const payload = await readJsonPayload(response);

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(response, payload, "Unable to export this run to Google Sheets."),
    );
  }

  return exportRunToGoogleSheetsResponseSchema.parse(payload);
}
