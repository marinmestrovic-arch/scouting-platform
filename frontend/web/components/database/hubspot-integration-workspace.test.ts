import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { renderToStringAsync } from "../../lib/test-render";

vi.mock("../../lib/hubspot-conflicts-api", () => ({
  fetchHubspotConflicts: vi.fn(),
}));

vi.mock("../../lib/hubspot-health-api", () => ({
  fetchHubspotHealth: vi.fn(),
  requestHubspotHealthCheck: vi.fn(),
}));

import {
  HubspotIntegrationWorkspace,
  HUBSPOT_HEALTH_POLL_INTERVAL_MS,
  isHubspotHealthCheckActive,
} from "./hubspot-integration-workspace";

describe("HubspotIntegrationWorkspace", () => {
  it("polls only queued or running durable health checks", () => {
    expect(HUBSPOT_HEALTH_POLL_INTERVAL_MS).toBe(2_000);
    expect(isHubspotHealthCheckActive("queued")).toBe(true);
    expect(isHubspotHealthCheckActive("running")).toBe(true);
    expect(isHubspotHealthCheckActive("completed")).toBe(false);
    expect(isHubspotHealthCheckActive("failed")).toBe(false);
    expect(isHubspotHealthCheckActive(null)).toBe(false);
  });

  it("shows read-only connection health and conflict review controls", async () => {
    const html = await renderToStringAsync(createElement(HubspotIntegrationWorkspace));

    expect(html).toContain("Connection health");
    expect(html).toContain("Run health check");
    expect(html).toContain("Field conflicts");
    expect(html).toContain("Shared-field disagreements");
    expect(html).toContain("Loading conflicts");
  });
});
