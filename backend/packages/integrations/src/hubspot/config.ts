import process from "node:process";

import { z } from "zod";

export const HUBSPOT_API_VERSION = "2026-03";
export const HUBSPOT_DEFAULT_BASE_URL = "https://api.hubapi.com";

export type HubspotEnvironment = Readonly<Record<string, string | undefined>>;

export type HubspotFeatureFlags = Readonly<{
  directSync: boolean;
  webhooks: boolean;
  webhookJournal: boolean;
  uiExtensions: boolean;
}>;

export type HubspotObjectMappings = Readonly<{
  clientObjectType: string | null;
  campaignObjectType: string | null;
  activationObjectType: string | null;
}>;

export type HubspotAssociationMappings = Readonly<{
  dealCampaignAssociationTypeId: number | null;
  dealClientAssociationTypeId: number | null;
  campaignClientAssociationTypeId: number | null;
}>;

export type HubspotPropertyMappings = Readonly<{
  contactUniqueIdProperty: string | null;
  contactWorkedWithProperty: string | null;
  dealUniqueIdProperty: string | null;
  clientNameProperty: string | null;
  clientDomainProperty: string | null;
  clientCountryRegionProperty: string | null;
  clientCityProperty: string | null;
  clientActiveProperty: string | null;
  campaignNameProperty: string | null;
  campaignClientObjectIdProperty: string | null;
  campaignMarketProperty: string | null;
  campaignBriefLinkProperty: string | null;
  campaignMonthProperty: string | null;
  campaignYearProperty: string | null;
  campaignStatusProperty: string | null;
  campaignActiveProperty: string | null;
  activationNameProperty: string | null;
  activationTypeProperty: string | null;
  activationUrlProperty: string | null;
  activationPublicationDateProperty: string | null;
}>;

export type HubspotConfig = Readonly<{
  accessToken: string;
  baseUrl: string;
  apiVersion: typeof HUBSPOT_API_VERSION;
  portalId: string | null;
  appId: string | null;
  clientId: string | null;
  clientSecret: string | null;
  featureFlags: HubspotFeatureFlags;
  objectMappings: HubspotObjectMappings;
  propertyMappings: HubspotPropertyMappings;
  associationMappings: HubspotAssociationMappings;
}>;

export type HubspotConfigErrorCode =
  | "HUBSPOT_ACCESS_TOKEN_MISSING"
  | "HUBSPOT_CONFIG_INVALID";

export class HubspotConfigError extends Error {
  readonly code: HubspotConfigErrorCode;

  constructor(code: HubspotConfigErrorCode, message: string) {
    super(message);
    this.name = "HubspotConfigError";
    this.code = code;
  }
}

const urlSchema = z.string().trim().url();

function optional(env: HubspotEnvironment, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function optionalPositiveInteger(env: HubspotEnvironment, key: string): number | null {
  const value = optional(env, key);
  if (value === null) {
    return null;
  }
  if (!/^\d+$/.test(value)) {
    throw new HubspotConfigError(
      "HUBSPOT_CONFIG_INVALID",
      `${key} must be a positive integer`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new HubspotConfigError(
      "HUBSPOT_CONFIG_INVALID",
      `${key} must be a positive integer`,
    );
  }
  return parsed;
}

function strictFlag(env: HubspotEnvironment, key: string): boolean {
  const value = env[key]?.trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new HubspotConfigError(
    "HUBSPOT_CONFIG_INVALID",
    `${key} must be either true or false`,
  );
}

export function loadHubspotFeatureFlags(
  env: HubspotEnvironment = process.env,
): HubspotFeatureFlags {
  return {
    directSync: strictFlag(env, "HUBSPOT_DIRECT_SYNC_ENABLED"),
    webhooks: strictFlag(env, "HUBSPOT_WEBHOOKS_ENABLED"),
    webhookJournal: strictFlag(env, "HUBSPOT_WEBHOOK_JOURNAL_ENABLED"),
    uiExtensions: strictFlag(env, "HUBSPOT_UI_EXTENSIONS_ENABLED"),
  };
}

export function loadHubspotConfig(env: HubspotEnvironment = process.env): HubspotConfig {
  const accessToken = optional(env, "HUBSPOT_ACCESS_TOKEN") ?? optional(env, "HUBSPOT_API_KEY");
  if (!accessToken) {
    throw new HubspotConfigError(
      "HUBSPOT_ACCESS_TOKEN_MISSING",
      "HUBSPOT_ACCESS_TOKEN or legacy HUBSPOT_API_KEY is required",
    );
  }

  const rawBaseUrl = optional(env, "HUBSPOT_BASE_URL") ?? HUBSPOT_DEFAULT_BASE_URL;
  const parsedBaseUrl = urlSchema.safeParse(rawBaseUrl);
  if (!parsedBaseUrl.success) {
    throw new HubspotConfigError(
      "HUBSPOT_CONFIG_INVALID",
      "HUBSPOT_BASE_URL must be a valid URL",
    );
  }
  const portalId = optional(env, "HUBSPOT_PORTAL_ID");
  if (portalId !== null && !/^\d+$/.test(portalId)) {
    throw new HubspotConfigError(
      "HUBSPOT_CONFIG_INVALID",
      "HUBSPOT_PORTAL_ID must contain only digits",
    );
  }
  const appId = optional(env, "HUBSPOT_APP_ID");
  if (appId !== null && !/^\d+$/.test(appId)) {
    throw new HubspotConfigError(
      "HUBSPOT_CONFIG_INVALID",
      "HUBSPOT_APP_ID must contain only digits",
    );
  }

  return {
    accessToken,
    baseUrl: parsedBaseUrl.data,
    apiVersion: HUBSPOT_API_VERSION,
    portalId,
    appId,
    clientId: optional(env, "HUBSPOT_CLIENT_ID"),
    clientSecret: optional(env, "HUBSPOT_CLIENT_SECRET"),
    featureFlags: loadHubspotFeatureFlags(env),
    objectMappings: {
      clientObjectType: optional(env, "HUBSPOT_CLIENT_OBJECT_TYPE"),
      campaignObjectType: optional(env, "HUBSPOT_CAMPAIGN_OBJECT_TYPE"),
      activationObjectType: optional(env, "HUBSPOT_ACTIVATION_OBJECT_TYPE"),
    },
    propertyMappings: {
      contactUniqueIdProperty: optional(env, "HUBSPOT_CONTACT_UNIQUE_ID_PROPERTY"),
      contactWorkedWithProperty: optional(env, "HUBSPOT_CONTACT_WORKED_WITH_PROPERTY"),
      dealUniqueIdProperty: optional(env, "HUBSPOT_DEAL_UNIQUE_ID_PROPERTY"),
      clientNameProperty: optional(env, "HUBSPOT_CLIENT_NAME_PROPERTY"),
      clientDomainProperty: optional(env, "HUBSPOT_CLIENT_DOMAIN_PROPERTY"),
      clientCountryRegionProperty: optional(env, "HUBSPOT_CLIENT_COUNTRY_REGION_PROPERTY"),
      clientCityProperty: optional(env, "HUBSPOT_CLIENT_CITY_PROPERTY"),
      clientActiveProperty: optional(env, "HUBSPOT_CLIENT_ACTIVE_PROPERTY"),
      campaignNameProperty: optional(env, "HUBSPOT_CAMPAIGN_NAME_PROPERTY"),
      campaignClientObjectIdProperty: optional(
        env,
        "HUBSPOT_CAMPAIGN_CLIENT_OBJECT_ID_PROPERTY",
      ),
      campaignMarketProperty: optional(env, "HUBSPOT_CAMPAIGN_MARKET_PROPERTY"),
      campaignBriefLinkProperty: optional(env, "HUBSPOT_CAMPAIGN_BRIEF_LINK_PROPERTY"),
      campaignMonthProperty: optional(env, "HUBSPOT_CAMPAIGN_MONTH_PROPERTY"),
      campaignYearProperty: optional(env, "HUBSPOT_CAMPAIGN_YEAR_PROPERTY"),
      campaignStatusProperty: optional(env, "HUBSPOT_CAMPAIGN_STATUS_PROPERTY"),
      campaignActiveProperty: optional(env, "HUBSPOT_CAMPAIGN_ACTIVE_PROPERTY"),
      activationNameProperty: optional(env, "HUBSPOT_ACTIVATION_NAME_PROPERTY"),
      activationTypeProperty: optional(env, "HUBSPOT_ACTIVATION_TYPE_PROPERTY"),
      activationUrlProperty: optional(env, "HUBSPOT_ACTIVATION_URL_PROPERTY"),
      activationPublicationDateProperty: optional(
        env,
        "HUBSPOT_ACTIVATION_PUBLICATION_DATE_PROPERTY",
      ),
    },
    associationMappings: {
      dealCampaignAssociationTypeId: optionalPositiveInteger(
        env,
        "HUBSPOT_DEAL_CAMPAIGN_ASSOCIATION_TYPE_ID",
      ),
      dealClientAssociationTypeId: optionalPositiveInteger(
        env,
        "HUBSPOT_DEAL_CLIENT_ASSOCIATION_TYPE_ID",
      ),
      campaignClientAssociationTypeId: optionalPositiveInteger(
        env,
        "HUBSPOT_CAMPAIGN_CLIENT_ASSOCIATION_TYPE_ID",
      ),
    },
  };
}

export type FetchLike = typeof fetch;
export type HubspotSleepFn = (milliseconds: number) => Promise<void>;

export type HubspotClientOptions = Readonly<{
  accessToken?: string;
  /** Legacy alias retained for current callers. */
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxRetryDelayMs?: number;
  sleepFn?: HubspotSleepFn;
  randomFn?: () => number;
  nowFn?: () => number;
}>;

export type ResolvedHubspotClientOptions = Readonly<{
  accessToken: string;
  baseUrl: string;
  fetchFn: FetchLike;
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  maxRetryDelayMs: number;
  sleepFn: HubspotSleepFn;
  randomFn: () => number;
  nowFn: () => number;
}>;

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new HubspotConfigError(
      "HUBSPOT_CONFIG_INVALID",
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return result;
}

export function resolveHubspotClientOptions(
  input: HubspotClientOptions = {},
  env: HubspotEnvironment = process.env,
): ResolvedHubspotClientOptions {
  const accessToken =
    input.accessToken?.trim() ||
    input.apiKey?.trim() ||
    optional(env, "HUBSPOT_ACCESS_TOKEN") ||
    optional(env, "HUBSPOT_API_KEY");
  if (!accessToken) {
    throw new HubspotConfigError(
      "HUBSPOT_ACCESS_TOKEN_MISSING",
      "HUBSPOT_ACCESS_TOKEN or legacy HUBSPOT_API_KEY is required",
    );
  }
  const rawBaseUrl = input.baseUrl?.trim() || optional(env, "HUBSPOT_BASE_URL") || HUBSPOT_DEFAULT_BASE_URL;
  const parsedBaseUrl = urlSchema.safeParse(rawBaseUrl);
  if (!parsedBaseUrl.success) {
    throw new HubspotConfigError(
      "HUBSPOT_CONFIG_INVALID",
      "HubSpot base URL must be a valid URL",
    );
  }

  return {
    accessToken,
    baseUrl: parsedBaseUrl.data,
    fetchFn: input.fetchFn ?? fetch,
    timeoutMs: boundedInteger(input.timeoutMs, 15_000, 1, 120_000, "HubSpot timeout"),
    maxRetries: boundedInteger(input.maxRetries, 3, 0, 5, "HubSpot max retries"),
    baseDelayMs: boundedInteger(input.baseDelayMs, 250, 0, 60_000, "HubSpot base delay"),
    maxRetryDelayMs: boundedInteger(
      input.maxRetryDelayMs,
      30_000,
      0,
      120_000,
      "HubSpot max retry delay",
    ),
    sleepFn:
      input.sleepFn ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    randomFn: input.randomFn ?? Math.random,
    nowFn: input.nowFn ?? Date.now,
  };
}
