import process from "node:process";

import { z } from "zod";

import { HubspotError } from "./contacts";

const hubspotPropertyOptionSchema = z.object({
  label: z.string().optional(),
  value: z.string().optional(),
});

const hubspotPropertyDefinitionSchema = z.object({
  name: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.string().trim().min(1),
  fieldType: z.string().trim().min(1).optional(),
  options: z.array(hubspotPropertyOptionSchema).default([]),
});

const fetchHubspotPropertyDefinitionInputSchema = z.object({
  objectType: z.string().trim().min(1),
  propertyName: z.string().trim().min(1),
  apiKey: z.string().trim().min(1).optional(),
  baseUrl: z.string().trim().url().default("https://api.hubapi.com"),
  fetchFn: z.custom<typeof fetch>().optional(),
});

type FetchLike = typeof fetch;

export type FetchHubspotPropertyDefinitionInput = z.input<
  typeof fetchHubspotPropertyDefinitionInputSchema
>;
export type HubspotPropertyDefinition = z.infer<typeof hubspotPropertyDefinitionSchema>;

function getApiKey(override?: string): string {
  const apiKey = override?.trim() || process.env.HUBSPOT_API_KEY?.trim();

  if (!apiKey) {
    throw new HubspotError(
      "HUBSPOT_API_KEY_MISSING",
      500,
      "HUBSPOT_API_KEY is required for HubSpot property sync",
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
    "HubSpot property sync failed",
  );
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchHubspotPropertyDefinition(
  rawInput: FetchHubspotPropertyDefinitionInput,
): Promise<HubspotPropertyDefinition> {
  const input = fetchHubspotPropertyDefinitionInputSchema.parse(rawInput);
  const apiKey = getApiKey(input.apiKey);
  const fetchFn = getFetch(input.fetchFn);
  const url = new URL(
    `/crm/v3/properties/${encodeURIComponent(input.objectType)}/${encodeURIComponent(input.propertyName)}`,
    input.baseUrl,
  );

  const response = await fetchFn(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw toProviderError(response);
  }

  const payload = await parseJsonResponse(response);
  const parsed = hubspotPropertyDefinitionSchema.safeParse(payload);

  if (!parsed.success) {
    throw new HubspotError(
      "HUBSPOT_INVALID_RESPONSE",
      502,
      "HubSpot returned an invalid property definition response",
    );
  }

  return parsed.data;
}
