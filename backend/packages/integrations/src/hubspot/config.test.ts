import { describe, expect, it } from "vitest";

import {
  HUBSPOT_API_VERSION,
  HUBSPOT_DEFAULT_BASE_URL,
  HubspotConfigError,
  loadHubspotConfig,
  loadHubspotFeatureFlags,
  resolveHubspotClientOptions,
} from "./config";

describe("HubSpot configuration", () => {
  it("prefers HUBSPOT_ACCESS_TOKEN over the legacy API key", () => {
    const config = loadHubspotConfig({
      HUBSPOT_ACCESS_TOKEN: "current-token",
      HUBSPOT_API_KEY: "legacy-token",
    });

    expect(config.accessToken).toBe("current-token");
    expect(config.apiVersion).toBe(HUBSPOT_API_VERSION);
    expect(config.baseUrl).toBe(HUBSPOT_DEFAULT_BASE_URL);
  });

  it("falls back to HUBSPOT_API_KEY for existing deployments", () => {
    const config = loadHubspotConfig({
      HUBSPOT_API_KEY: "legacy-token",
    });

    expect(config.accessToken).toBe("legacy-token");
  });

  it("lets explicit client credentials override environment credentials", () => {
    const resolved = resolveHubspotClientOptions(
      {
        accessToken: "explicit-access-token",
        apiKey: "explicit-legacy-token",
      },
      {
        HUBSPOT_ACCESS_TOKEN: "environment-access-token",
        HUBSPOT_API_KEY: "environment-legacy-token",
      },
    );

    expect(resolved.accessToken).toBe("explicit-access-token");
  });

  it("keeps every rollout feature disabled by default", () => {
    expect(loadHubspotFeatureFlags({})).toEqual({
      directSync: false,
      webhooks: false,
      webhookJournal: false,
      uiExtensions: false,
    });
  });

  it("accepts explicit true and false flags but rejects ambiguous values", () => {
    expect(
      loadHubspotFeatureFlags({
        HUBSPOT_DIRECT_SYNC_ENABLED: " TRUE ",
        HUBSPOT_WEBHOOKS_ENABLED: "false",
      }),
    ).toMatchObject({
      directSync: true,
      webhooks: false,
    });

    expect(() =>
      loadHubspotFeatureFlags({
        HUBSPOT_DIRECT_SYNC_ENABLED: "yes",
      }),
    ).toThrow(
      expect.objectContaining({
        code: "HUBSPOT_CONFIG_INVALID",
      }) as HubspotConfigError,
    );
  });

  it("normalizes portal object and property mappings without guessing missing values", () => {
    const config = loadHubspotConfig({
      HUBSPOT_ACCESS_TOKEN: "access-token",
      HUBSPOT_BASE_URL: "https://hubspot.test",
      HUBSPOT_PORTAL_ID: "123456",
      HUBSPOT_APP_ID: "789012",
      HUBSPOT_CLIENT_ID: "app-client-id",
      HUBSPOT_CLIENT_SECRET: "app-client-secret",
      HUBSPOT_CLIENT_OBJECT_TYPE: "2-client",
      HUBSPOT_CAMPAIGN_OBJECT_TYPE: "2-campaign",
      HUBSPOT_ACTIVATION_OBJECT_TYPE: "2-activation",
      HUBSPOT_CONTACT_UNIQUE_ID_PROPERTY: "atlas_contact_id",
      HUBSPOT_CONTACT_WORKED_WITH_PROPERTY: "worked_with",
      HUBSPOT_DEAL_UNIQUE_ID_PROPERTY: "atlas_run_id",
      HUBSPOT_CLIENT_NAME_PROPERTY: "client_name",
      HUBSPOT_CLIENT_DOMAIN_PROPERTY: "client_domain",
      HUBSPOT_CLIENT_COUNTRY_REGION_PROPERTY: "client_country",
      HUBSPOT_CLIENT_CITY_PROPERTY: "client_city",
      HUBSPOT_CLIENT_ACTIVE_PROPERTY: "client_active",
      HUBSPOT_CAMPAIGN_NAME_PROPERTY: "campaign_name",
      HUBSPOT_CAMPAIGN_CLIENT_OBJECT_ID_PROPERTY: "client_object_id",
      HUBSPOT_DEAL_CAMPAIGN_ASSOCIATION_TYPE_ID: "34",
      HUBSPOT_DEAL_CLIENT_ASSOCIATION_TYPE_ID: "94",
      HUBSPOT_CAMPAIGN_MARKET_PROPERTY: "market",
      HUBSPOT_CAMPAIGN_BRIEF_LINK_PROPERTY: "brief_link",
      HUBSPOT_CAMPAIGN_MONTH_PROPERTY: "month",
      HUBSPOT_CAMPAIGN_YEAR_PROPERTY: "year",
      HUBSPOT_CAMPAIGN_STATUS_PROPERTY: "status",
      HUBSPOT_CAMPAIGN_ACTIVE_PROPERTY: "campaign_active",
      HUBSPOT_ACTIVATION_NAME_PROPERTY: "activation_name",
      HUBSPOT_ACTIVATION_TYPE_PROPERTY: "activation_type",
      HUBSPOT_ACTIVATION_URL_PROPERTY: "activation_url",
      HUBSPOT_ACTIVATION_PUBLICATION_DATE_PROPERTY: "publication_date",
    });

    expect(config).toMatchObject({
      baseUrl: "https://hubspot.test",
      apiVersion: "2026-03",
      portalId: "123456",
      appId: "789012",
      clientId: "app-client-id",
      clientSecret: "app-client-secret",
      objectMappings: {
        clientObjectType: "2-client",
        campaignObjectType: "2-campaign",
        activationObjectType: "2-activation",
      },
      propertyMappings: {
        contactUniqueIdProperty: "atlas_contact_id",
        contactWorkedWithProperty: "worked_with",
        dealUniqueIdProperty: "atlas_run_id",
        clientNameProperty: "client_name",
        clientDomainProperty: "client_domain",
        clientCountryRegionProperty: "client_country",
        clientCityProperty: "client_city",
        clientActiveProperty: "client_active",
        campaignNameProperty: "campaign_name",
        campaignClientObjectIdProperty: "client_object_id",
        campaignMarketProperty: "market",
        campaignBriefLinkProperty: "brief_link",
        campaignMonthProperty: "month",
        campaignYearProperty: "year",
        campaignStatusProperty: "status",
        campaignActiveProperty: "campaign_active",
        activationNameProperty: "activation_name",
        activationTypeProperty: "activation_type",
        activationUrlProperty: "activation_url",
        activationPublicationDateProperty: "publication_date",
      },
      associationMappings: {
        dealCampaignAssociationTypeId: 34,
        dealClientAssociationTypeId: 94,
        campaignClientAssociationTypeId: null,
      },
    });
  });

  it("rejects an invalid Deal to Campaign association type ID", () => {
    expect(() =>
      loadHubspotConfig({
        HUBSPOT_ACCESS_TOKEN: "access-token",
        HUBSPOT_DEAL_CAMPAIGN_ASSOCIATION_TYPE_ID: "not-an-id",
      }),
    ).toThrow(
      expect.objectContaining({ code: "HUBSPOT_CONFIG_INVALID" }) as HubspotConfigError,
    );
  });

  it("keeps the numeric app ID distinct from the OAuth client ID", () => {
    expect(() =>
      loadHubspotConfig({
        HUBSPOT_ACCESS_TOKEN: "access-token",
        HUBSPOT_APP_ID: "oauth-client-id",
      }),
    ).toThrow(
      expect.objectContaining({ code: "HUBSPOT_CONFIG_INVALID" }) as HubspotConfigError,
    );
  });

  it("reports invalid public configuration without including credentials", () => {
    const secret = "private-token-that-must-not-leak";

    let error: unknown;
    try {
      loadHubspotConfig({
        HUBSPOT_ACCESS_TOKEN: secret,
        HUBSPOT_BASE_URL: "not a URL",
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HubspotConfigError);
    expect(String(error)).not.toContain(secret);
  });
});
