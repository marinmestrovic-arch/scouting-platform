import { z } from "zod";

import { HubspotError, hubspotRequest } from "./client";
import type { HubspotClientOptions } from "./client";
import { HUBSPOT_API_VERSION } from "./config";

const hubspotPropertyOptionSchema = z.object({
  label: z.string(),
  value: z.string(),
  description: z.string().optional(),
  displayOrder: z.number().int().optional(),
  hidden: z.boolean().optional(),
});

export const hubspotPropertyDefinitionSchema = z.object({
  name: z.string().trim().min(1),
  label: z.string(),
  type: z.string().trim().min(1),
  fieldType: z.string().optional(),
  description: z.string().optional(),
  groupName: z.string().optional(),
  // HubSpot returns an explicit options array, including for properties with
  // no options. Omission is a partial response, not proof of no references.
  options: z.array(hubspotPropertyOptionSchema),
  hasUniqueValue: z.boolean().default(false),
  calculated: z.boolean().optional(),
  externalOptions: z.boolean().optional(),
  archived: z.boolean().default(false),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const hubspotPropertiesResponseSchema = z.object({
  results: z.array(hubspotPropertyDefinitionSchema),
});

const rawHubspotAccountDetailsSchema = z.object({
  portalId: z
    .union([z.string().trim().min(1), z.number().int().positive()])
    .transform((value) => String(value))
    .optional(),
  accountType: z.string().optional(),
  timeZone: z.string().optional(),
  timezone: z.string().optional(),
  companyCurrency: z.string().trim().min(1).nullable().optional(),
  additionalCurrencies: z
    .array(z.string().trim().min(1))
    .nullable()
    .optional()
    .transform((value) => value ?? []),
  uiDomain: z.string().optional(),
  dataHostingLocation: z.string().optional(),
  utcOffset: z.string().optional(),
  utcOffsetMilliseconds: z.number().int().optional(),
});

const hubspotAccountDetailsSchema = rawHubspotAccountDetailsSchema.transform((value) => ({
  ...(value.portalId ? { portalId: value.portalId } : {}),
  ...(value.accountType ? { accountType: value.accountType } : {}),
  ...(value.timeZone ?? value.timezone
    ? { timeZone: (value.timeZone ?? value.timezone) as string }
    : {}),
  companyCurrency: value.companyCurrency,
  additionalCurrencies: value.additionalCurrencies,
  ...(value.uiDomain ? { uiDomain: value.uiDomain } : {}),
  ...(value.dataHostingLocation ? { dataHostingLocation: value.dataHostingLocation } : {}),
  ...(value.utcOffset ? { utcOffset: value.utcOffset } : {}),
  ...(typeof value.utcOffsetMilliseconds === "number"
    ? { utcOffsetMilliseconds: value.utcOffsetMilliseconds }
    : {}),
}));

const hubspotAccountIdentitySchema = rawHubspotAccountDetailsSchema
  .extend({
    portalId: z
      .union([z.string().trim().min(1), z.number().int().positive()])
      .transform((value) => String(value)),
  })
  .transform((value) => ({
    portalId: value.portalId,
    ...(value.accountType ? { accountType: value.accountType } : {}),
    ...(value.timeZone ?? value.timezone
      ? { timeZone: (value.timeZone ?? value.timezone) as string }
      : {}),
    companyCurrency: value.companyCurrency,
    additionalCurrencies: value.additionalCurrencies,
    ...(value.uiDomain ? { uiDomain: value.uiDomain } : {}),
    ...(value.dataHostingLocation ? { dataHostingLocation: value.dataHostingLocation } : {}),
    ...(value.utcOffset ? { utcOffset: value.utcOffset } : {}),
    ...(typeof value.utcOffsetMilliseconds === "number"
      ? { utcOffsetMilliseconds: value.utcOffsetMilliseconds }
      : {}),
  }));

export type FetchHubspotPropertyDefinitionInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    propertyName: string;
    archived?: boolean;
  }>;

export type FetchHubspotPropertiesInput = HubspotClientOptions &
  Readonly<{
    objectType: string;
    archived?: boolean;
  }>;

export type FetchHubspotAccountDetailsInput = HubspotClientOptions;
export type HubspotPropertyOption = z.infer<typeof hubspotPropertyOptionSchema>;
export type HubspotPropertyDefinition = z.infer<typeof hubspotPropertyDefinitionSchema>;
export type HubspotAccountDetails = z.infer<typeof hubspotAccountDetailsSchema>;
export type HubspotAccountIdentity = z.infer<typeof hubspotAccountIdentitySchema>;

function nonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HubspotError("HUBSPOT_INVALID_INPUT", 400, `HubSpot ${field} must not be empty`, {
      retryable: false,
    });
  }
  return trimmed;
}

export function findHubspotPropertyOptionByLabel(
  definition: HubspotPropertyDefinition,
  label: string,
): HubspotPropertyOption | null {
  const normalized = label.trim();
  const matches = definition.options.filter((option) => option.label === normalized);
  if (matches.length > 1) {
    throw new HubspotError(
      "HUBSPOT_INVALID_RESPONSE",
      502,
      "HubSpot returned duplicate property option labels",
      { retryable: false },
    );
  }
  return matches[0] ?? null;
}

export async function fetchHubspotAccountDetails(
  input: FetchHubspotAccountDetailsInput = {},
): Promise<HubspotAccountDetails> {
  return hubspotRequest({
    ...input,
    path: `/account-info/${HUBSPOT_API_VERSION}/details`,
    responseSchema: hubspotAccountDetailsSchema,
  });
}

export async function fetchHubspotAccountIdentity(
  input: FetchHubspotAccountDetailsInput = {},
): Promise<HubspotAccountIdentity> {
  return hubspotRequest({
    ...input,
    path: `/account-info/${HUBSPOT_API_VERSION}/details`,
    responseSchema: hubspotAccountIdentitySchema,
  });
}

export async function fetchHubspotProperties(
  input: FetchHubspotPropertiesInput,
): Promise<HubspotPropertyDefinition[]> {
  const objectType = nonBlank(input.objectType, "property object type");
  const url = new URL(
    `/crm/properties/${HUBSPOT_API_VERSION}/${encodeURIComponent(objectType)}`,
    "https://hubspot.invalid",
  );
  url.searchParams.set("archived", input.archived === true ? "true" : "false");
  const response = await hubspotRequest({
    ...input,
    path: `${url.pathname}${url.search}`,
    responseSchema: hubspotPropertiesResponseSchema,
  });
  return response.results;
}

export async function fetchHubspotPropertyDefinition(
  input: FetchHubspotPropertyDefinitionInput,
): Promise<HubspotPropertyDefinition> {
  const objectType = nonBlank(input.objectType, "property object type");
  const propertyName = nonBlank(input.propertyName, "property name");
  const url = new URL(
    `/crm/properties/${HUBSPOT_API_VERSION}/${encodeURIComponent(objectType)}/${encodeURIComponent(propertyName)}`,
    "https://hubspot.invalid",
  );
  url.searchParams.set("archived", input.archived === true ? "true" : "false");
  return hubspotRequest({
    ...input,
    path: `${url.pathname}${url.search}`,
    responseSchema: hubspotPropertyDefinitionSchema,
  });
}
