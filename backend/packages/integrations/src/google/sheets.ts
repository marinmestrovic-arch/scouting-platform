import { createPrivateKey, createSign } from "node:crypto";
import process from "node:process";

import { z } from "zod";

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SHEETS_API_BASE_URL = "https://sheets.googleapis.com";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const googleServiceAccountCredentialsSchema = z.object({
  clientEmail: z.string().trim().email(),
  privateKey: z.string().trim().min(1),
});

const googleSheetsAccessTokenResponseSchema = z.object({
  access_token: z.string().trim().min(1),
});

const googleSheetsValueRangeResponseSchema = z.object({
  values: z.array(z.array(z.string())).optional(),
});

const googleSheetsAppendResponseSchema = z.object({
  updates: z
    .object({
      updatedRange: z.string().trim().min(1).optional(),
      updatedRows: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

type FetchLike = typeof fetch;

export type GoogleSheetsErrorCode =
  | "GOOGLE_SHEETS_CREDENTIALS_MISSING"
  | "GOOGLE_SHEETS_AUTH_FAILED"
  | "GOOGLE_SHEETS_FORBIDDEN"
  | "GOOGLE_SHEETS_NOT_FOUND"
  | "GOOGLE_SHEETS_RATE_LIMITED"
  | "GOOGLE_SHEETS_INVALID_RESPONSE"
  | "GOOGLE_SHEETS_REQUEST_FAILED";

export class GoogleSheetsError extends Error {
  readonly code: GoogleSheetsErrorCode;
  readonly status: number;

  constructor(code: GoogleSheetsErrorCode, status: number, message: string) {
    super(message);
    this.name = "GoogleSheetsError";
    this.code = code;
    this.status = status;
  }
}

export function isGoogleSheetsError(error: unknown): error is GoogleSheetsError {
  return error instanceof GoogleSheetsError;
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function getServiceAccountCredentials(input?: {
  clientEmail?: string;
  privateKey?: string;
}): z.infer<typeof googleServiceAccountCredentialsSchema> {
  const clientEmail = input?.clientEmail?.trim() || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKeyValue =
    input?.privateKey?.trim() || process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();

  if (!clientEmail || !privateKeyValue) {
    throw new GoogleSheetsError(
      "GOOGLE_SHEETS_CREDENTIALS_MISSING",
      500,
      "Google Sheets service account credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.",
    );
  }

  return googleServiceAccountCredentialsSchema.parse({
    clientEmail,
    privateKey: normalizePrivateKey(privateKeyValue),
  });
}

function getFetch(fetchFn?: FetchLike): FetchLike {
  return fetchFn ?? fetch;
}

function encodeJwtPart(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function createSignedJwt(input: {
  clientEmail: string;
  privateKey: string;
  tokenUrl: string;
}): string {
  const issuedAtSeconds = Math.floor(Date.now() / 1000);
  const header = encodeJwtPart({
    alg: "RS256",
    typ: "JWT",
  });
  const claimSet = encodeJwtPart({
    iss: input.clientEmail,
    scope: GOOGLE_SHEETS_SCOPE,
    aud: input.tokenUrl,
    exp: issuedAtSeconds + 3600,
    iat: issuedAtSeconds,
  });
  const unsignedToken = `${header}.${claimSet}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsignedToken);
  signer.end();

  const signature = signer
    .sign(createPrivateKey(input.privateKey))
    .toString("base64url");

  return `${unsignedToken}.${signature}`;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getProviderMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = (payload as { error?: unknown }).error;

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return ((error as { message: string }).message || "").trim() || null;
  }

  return null;
}

function toGoogleSheetsError(
  response: Response,
  payload: unknown,
  fallbackMessage: string,
): GoogleSheetsError {
  const providerMessage = getProviderMessage(payload);
  const message = providerMessage ? `${fallbackMessage}: ${providerMessage}` : fallbackMessage;

  if (response.status === 401) {
    return new GoogleSheetsError("GOOGLE_SHEETS_AUTH_FAILED", 401, message);
  }

  if (response.status === 403) {
    return new GoogleSheetsError(
      "GOOGLE_SHEETS_FORBIDDEN",
      403,
      message,
    );
  }

  if (response.status === 404) {
    return new GoogleSheetsError("GOOGLE_SHEETS_NOT_FOUND", 404, message);
  }

  if (response.status === 429) {
    return new GoogleSheetsError("GOOGLE_SHEETS_RATE_LIMITED", 429, message);
  }

  return new GoogleSheetsError("GOOGLE_SHEETS_REQUEST_FAILED", 502, message);
}

export async function getGoogleSheetsAccessToken(input?: {
  clientEmail?: string;
  privateKey?: string;
  fetchFn?: FetchLike;
  tokenUrl?: string;
}): Promise<string> {
  const credentials = getServiceAccountCredentials(input);
  const fetchFn = getFetch(input?.fetchFn);
  const tokenUrl = input?.tokenUrl?.trim() || GOOGLE_OAUTH_TOKEN_URL;
  const assertion = createSignedJwt({
    clientEmail: credentials.clientEmail,
    privateKey: credentials.privateKey,
    tokenUrl,
  });

  const response = await fetchFn(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw toGoogleSheetsError(
      response,
      payload,
      "Unable to authenticate with Google Sheets",
    );
  }

  const parsed = googleSheetsAccessTokenResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new GoogleSheetsError(
      "GOOGLE_SHEETS_INVALID_RESPONSE",
      502,
      "Google OAuth returned an invalid access token response",
    );
  }

  return parsed.data.access_token;
}

export function extractGoogleSpreadsheetId(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  const isLikelyId = /^[a-zA-Z0-9-_]+$/.test(trimmed);

  return isLikelyId ? trimmed : null;
}

function toA1Range(sheetName: string, range: string): string {
  const escapedSheetName = sheetName.replace(/'/g, "''");
  return `'${escapedSheetName}'!${range}`;
}

export async function readGoogleSheetsHeaderRow(input: {
  spreadsheetId: string;
  sheetName: string;
  accessToken?: string;
  clientEmail?: string;
  privateKey?: string;
  fetchFn?: FetchLike;
  baseUrl?: string;
  tokenUrl?: string;
}): Promise<string[]> {
  const fetchFn = getFetch(input.fetchFn);
  const accessToken =
    input.accessToken ??
    (await getGoogleSheetsAccessToken({
      fetchFn,
      ...(input.clientEmail ? { clientEmail: input.clientEmail } : {}),
      ...(input.privateKey ? { privateKey: input.privateKey } : {}),
      ...(input.tokenUrl ? { tokenUrl: input.tokenUrl } : {}),
    }));
  const baseUrl = input.baseUrl?.trim() || GOOGLE_SHEETS_API_BASE_URL;
  const range = toA1Range(input.sheetName, "1:1");
  const url = new URL(
    `/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(range)}`,
    baseUrl,
  );
  url.searchParams.set("majorDimension", "ROWS");

  const response = await fetchFn(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw toGoogleSheetsError(
      response,
      payload,
      "Unable to read the Google Sheets header row",
    );
  }

  const parsed = googleSheetsValueRangeResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new GoogleSheetsError(
      "GOOGLE_SHEETS_INVALID_RESPONSE",
      502,
      "Google Sheets returned an invalid header response",
    );
  }

  return (parsed.data.values?.[0] ?? []).map((value) => value.trim());
}

export async function appendGoogleSheetsRows(input: {
  spreadsheetId: string;
  sheetName: string;
  rows: string[][];
  accessToken?: string;
  clientEmail?: string;
  privateKey?: string;
  fetchFn?: FetchLike;
  baseUrl?: string;
  tokenUrl?: string;
}): Promise<{ updatedRange: string | null; updatedRows: number }> {
  if (input.rows.length === 0) {
    return {
      updatedRange: null,
      updatedRows: 0,
    };
  }

  const fetchFn = getFetch(input.fetchFn);
  const accessToken =
    input.accessToken ??
    (await getGoogleSheetsAccessToken({
      fetchFn,
      ...(input.clientEmail ? { clientEmail: input.clientEmail } : {}),
      ...(input.privateKey ? { privateKey: input.privateKey } : {}),
      ...(input.tokenUrl ? { tokenUrl: input.tokenUrl } : {}),
    }));
  const baseUrl = input.baseUrl?.trim() || GOOGLE_SHEETS_API_BASE_URL;
  const range = toA1Range(input.sheetName, "A1");
  const url = new URL(
    `/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(range)}:append`,
    baseUrl,
  );
  url.searchParams.set("valueInputOption", "USER_ENTERED");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");

  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      majorDimension: "ROWS",
      values: input.rows,
    }),
  });
  const payload = await parseJsonResponse(response);

  if (!response.ok) {
    throw toGoogleSheetsError(
      response,
      payload,
      "Unable to append rows to Google Sheets",
    );
  }

  const parsed = googleSheetsAppendResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new GoogleSheetsError(
      "GOOGLE_SHEETS_INVALID_RESPONSE",
      502,
      "Google Sheets returned an invalid append response",
    );
  }

  return {
    updatedRange: parsed.data.updates?.updatedRange ?? null,
    updatedRows: parsed.data.updates?.updatedRows ?? input.rows.length,
  };
}
