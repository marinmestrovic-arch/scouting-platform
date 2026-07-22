import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getHubspotExtensionContextMock,
  toRouteErrorResponseMock,
  verifyHubspotExtensionRequestMock,
} = vi.hoisted(() => ({
  getHubspotExtensionContextMock: vi.fn(),
  verifyHubspotExtensionRequestMock: vi.fn(),
  toRouteErrorResponseMock: vi.fn((error: unknown) => {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : 500;
    return Response.json({ error: "Signed request rejected" }, { status });
  }),
}));

vi.mock("@scouting-platform/core", () => ({
  getHubspotExtensionContext: getHubspotExtensionContextMock,
  verifyHubspotExtensionRequest: verifyHubspotExtensionRequestMock,
}));

vi.mock("../../../../../../lib/api", () => ({
  toRouteErrorResponse: toRouteErrorResponseMock,
}));

import { GET } from "./route";

const contextResult = {
  creator: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Creator One",
    handle: "@creator",
    platformUrl:
      "https://scouting.example.com/catalog/11111111-1111-4111-8111-111111111111",
    followers: "250000",
    averageViews: "75000",
    engagementRate: 4.2,
  },
  run: null,
  sync: {
    status: "completed",
    lastSuccessfulSyncAt: "2026-07-20T08:00:00.000Z",
  },
};

function contextUrl(overrides: Record<string, string | null> = {}): string {
  const url = new URL(
    "http://web.internal:3000/api/integrations/hubspot/extension/context",
  );
  const values: Record<string, string> = {
    portalId: "123456",
    userId: "654321",
    userEmail: "operator@example.com",
    appId: "987654",
    objectId: "42",
    objectType: "0-1",
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete values[key];
    } else {
      values[key] = value;
    }
  }

  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function requestFor(url = contextUrl()): Request {
  return new Request(url, {
    headers: {
      "x-forwarded-host": "scouting.example.com",
      "x-forwarded-proto": "https",
      "x-hubspot-signature-v3": "signed-extension-request",
      "x-hubspot-request-timestamp": "1784534400000",
    },
  });
}

describe("HubSpot UI extension context route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://scouting.example.com");
    verifyHubspotExtensionRequestMock.mockReturnValue({
      portalId: "123456",
      appId: "987654",
    });
    getHubspotExtensionContextMock.mockResolvedValue(contextResult);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns signed record context without exposing provider credentials", async () => {
    const request = requestFor();

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload).toEqual(contextResult);
    expect(verifyHubspotExtensionRequestMock).toHaveBeenCalledWith({
      method: "GET",
      uri: `https://scouting.example.com${new URL(request.url).pathname}${new URL(request.url).search}`,
      rawBody: "",
      signature: "signed-extension-request",
      timestamp: "1784534400000",
    });
    expect(getHubspotExtensionContextMock).toHaveBeenCalledWith({
      portalId: "123456",
      userEmail: "operator@example.com",
      objectId: "42",
      objectType: "0-1",
      platformBaseUrl: "https://scouting.example.com",
    });

    const serializedPayload = JSON.stringify(payload);
    expect(serializedPayload).not.toContain("accessToken");
    expect(serializedPayload).not.toContain("clientSecret");
  });

  it("rejects malformed auto-appended context before reading platform data", async () => {
    const response = await GET(requestFor(contextUrl({ userId: null })));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      "Invalid HubSpot extension context",
    );
    expect(getHubspotExtensionContextMock).not.toHaveBeenCalled();
  });

  it("rejects non-numeric signed HubSpot identity fields", async () => {
    const response = await GET(requestFor(contextUrl({ appId: "client-id" })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid HubSpot extension context",
    });
    expect(getHubspotExtensionContextMock).not.toHaveBeenCalled();
  });

  it("rejects a request whose numeric app id is not the configured app", async () => {
    const response = await GET(requestFor(contextUrl({ appId: "111111" })));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "HubSpot extension context is not authorized",
    });
    expect(getHubspotExtensionContextMock).not.toHaveBeenCalled();
  });

  it("rejects a portal other than the configured single account", async () => {
    const response = await GET(requestFor(contextUrl({ portalId: "999999" })));

    expect(response.status).toBe(403);
    expect(getHubspotExtensionContextMock).not.toHaveBeenCalled();
  });

  it("normalizes signature failures without returning their details", async () => {
    verifyHubspotExtensionRequestMock.mockImplementation(() => {
      throw Object.assign(new Error("do not return this verifier detail"), {
        status: 401,
        code: "HUBSPOT_WEBHOOK_SIGNATURE_INVALID",
      });
    });

    const response = await GET(requestFor());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Signed request rejected" });
    expect(getHubspotExtensionContextMock).not.toHaveBeenCalled();
  });

  it("fails closed when the public platform URL is absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    const response = await GET(requestFor());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "HubSpot extension context is not configured",
    });
    expect(getHubspotExtensionContextMock).not.toHaveBeenCalled();
  });
});
