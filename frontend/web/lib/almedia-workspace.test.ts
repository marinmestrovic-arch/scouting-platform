import { describe, expect, it } from "vitest";

import {
  ALMEDIA_TABS_IN_ORDER,
  buildAlmediaWorkspaceHref,
  formatAlmediaSyncFailure,
  resolveAlmediaTab,
} from "./almedia-workspace";

describe("resolveAlmediaTab", () => {
  it("defaults to insights", () => {
    expect(resolveAlmediaTab(new URLSearchParams())).toBe("insights");
  });

  it("reads a known tab from the query string", () => {
    expect(resolveAlmediaTab(new URLSearchParams("tab=performance"))).toBe(
      "performance",
    );
    expect(resolveAlmediaTab(new URLSearchParams("tab=scorecard"))).toBe("scorecard");
  });

  it("falls back to insights for an unknown tab", () => {
    expect(resolveAlmediaTab(new URLSearchParams("tab=forecast"))).toBe("insights");
  });
});

describe("buildAlmediaWorkspaceHref", () => {
  it("omits the default tab from the URL", () => {
    expect(
      buildAlmediaWorkspaceHref("/almedia", new URLSearchParams("tab=scorecard"), {
        tab: "insights",
      }),
    ).toBe("/almedia");
  });

  it("writes non-default tabs", () => {
    expect(
      buildAlmediaWorkspaceHref("/almedia", new URLSearchParams(), {
        tab: "performance",
      }),
    ).toBe("/almedia?tab=performance");
  });

  it("preserves unrelated query params", () => {
    expect(
      buildAlmediaWorkspaceHref("/almedia", new URLSearchParams("month=2026-07"), {
        tab: "scorecard",
      }),
    ).toBe("/almedia?month=2026-07&tab=scorecard");
  });
});

describe("tab order", () => {
  it("runs from what happened, through the plan, to what gets billed", () => {
    expect(ALMEDIA_TABS_IN_ORDER).toEqual([
      "insights",
      "bookings",
      "performance",
      "scorecard",
      "invoices",
    ]);
  });

  it("reads the invoices tab from the query string", () => {
    expect(resolveAlmediaTab(new URLSearchParams("tab=invoices"))).toBe("invoices");
    expect(
      buildAlmediaWorkspaceHref("/almedia", new URLSearchParams(), {
        tab: "invoices",
      }),
    ).toBe("/almedia?tab=invoices");
  });
});

describe("formatAlmediaSyncFailure", () => {
  it("turns a missing worker key stack into an actionable setup message", () => {
    expect(
      formatAlmediaSyncFailure(
        "ServiceError: ALMEDIA_API_KEY is not configured on this process\n    at resolveApiKey (/workspace/backend/packages/core/src/almedia/campaigns.ts:41:11)",
      ),
    ).toBe(
      "Almedia sync is not configured on the worker. Set ALMEDIA_API_KEY, then retry.",
    );
  });

  it("does not expose an unexpected worker stack", () => {
    const message = formatAlmediaSyncFailure(
      "Error: provider failed\n    at fetchAllCampaigns (/workspace/backend/packages/integrations/src/almedia/agency-data.ts:100:5)",
    );

    expect(message).toBe(
      "Almedia sync could not refresh. Existing data is still available; retry or check the worker logs.",
    );
    expect(message).not.toContain("/workspace/");
  });
});
