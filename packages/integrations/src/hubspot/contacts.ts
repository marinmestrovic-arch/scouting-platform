import process from "node:process";

import { z } from "zod";

const hubspotUpsertContactInputSchema = z.object({
  email: z.string().trim().email(),
  properties: z.record(z.string(), z.string()),
  apiKey: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().url().default("https://api.hubapi.com"),
  fetchFn: z.custom<typeof fetch>().optional(),
});

const hubspotContactResponseSchema = z.object({
  id: z.string().trim().min(1),
  properties: z.record(z.string(), z.unknown()).optional(),
});

type FetchLike = typeof fetch;

export type HubspotErrorCode =
  | "HUBSPOT_API_KEY_MISSING"
  | "HUBSPOT_AUTH_FAILED"
  | "HUBSPOT_RATE_LIMITED"
  | "HUBSPOT_INVALID_RESPONSE"
  | "HUBSPOT_REQUEST_FAILED";

export type UpsertHubspotContactInput = z.input<typeof hubspotUpsertContactInputSchema>;
export type UpsertHubspotContactResult = z.infer<typeof hubspotContactResponseSchema>;

export class HubspotError extends Error {
  readonly code: HubspotErrorCode;
  readonly status: number;

  constructor(code: HubspotErrorCode, status: number, message: string) {
    super(message);
    this.name = "HubspotError";
    this.code = code;
    this.status = status;
  }
}

export function isHubspotError(error: unknown): error is HubspotError {
  return error instanceof HubspotError;
}

function getApiKey(override?: string): string {
  const apiKey = override?.trim() || process.env.HUBSPOT_API_KEY?.trim();

  if (!apiKey) {
    throw new HubspotError(
      "HUBSPOT_API_KEY_MISSING",
      500,
      "HUBSPOT_API_KEY is required for HubSpot pushes",
    );
  }

  return apiKey;
}

function getFetch(fetchFn?: FetchLike): FetchLike {
  return fetchFn ?? fetch;
}

function toProviderError(response: Response): HubspotError {
  if (response.status === 401 || response.status === 403) {
    return new HubspotError(
      "HUBSPOT_AUTH_FAILED",
      401,
      "HubSpot credentials are invalid or unauthorized",
    );
  }

  if (response.status === 429) {
    return new HubspotError(
      "HUBSPOT_RATE_LIMITED",
      429,
      "HubSpot rate limit exceeded",
    );
  }

  return new HubspotError(
    "HUBSPOT_REQUEST_FAILED",
    502,
    "HubSpot request failed",
  );
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function upsertHubspotContact(
  rawInput: UpsertHubspotContactInput,
): Promise<UpsertHubspotContactResult> {
  const input = hubspotUpsertContactInputSchema.parse(rawInput);
  const apiKey = getApiKey(input.apiKey);
  const fetchFn = getFetch(input.fetchFn);
  const url = new URL(`/crm/v3/objects/contacts/${encodeURIComponent(input.email)}`, input.baseUrl);
  url.searchParams.set("idProperty", "email");

  const response = await fetchFn(url, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      properties: input.properties,
    }),
  });

  if (!response.ok) {
    throw toProviderError(response);
  }

  const payload = await parseJsonResponse(response);
  const parsed = hubspotContactResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new HubspotError(
      "HUBSPOT_INVALID_RESPONSE",
      502,
      "HubSpot returned an invalid contact response",
    );
  }

  return parsed.data;
}
