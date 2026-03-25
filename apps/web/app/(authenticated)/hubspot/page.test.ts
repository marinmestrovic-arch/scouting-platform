import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hubspotPushManagerMock } = vi.hoisted(() => ({
  hubspotPushManagerMock: vi.fn(() => "hubspot-push-manager"),
}));

vi.mock("../../../components/hubspot/hubspot-push-manager", () => ({
  HubspotPushManager: hubspotPushManagerMock,
}));

import HubspotPage from "./page";

describe("hubspot page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the HubSpot push manager workspace", () => {
    const html = renderToStaticMarkup(HubspotPage());

    expect(html).toContain("HubSpot");
    expect(html).toContain(
      "Review Week 7 import-ready CSV batches, inspect missing-field failures, and keep legacy Week 6 push history readable without leaving the authenticated workspace.",
    );
    expect(hubspotPushManagerMock).toHaveBeenCalledTimes(1);
    expect(html).toContain("hubspot-push-manager");
  });
});
