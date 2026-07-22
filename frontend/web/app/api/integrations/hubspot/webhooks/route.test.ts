import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  acceptHubspotWebhookDeliveryMock,
  toRouteErrorResponseMock,
  verifyHubspotWebhookRequestMock,
} = vi.hoisted(() => ({
  acceptHubspotWebhookDeliveryMock: vi.fn(),
  verifyHubspotWebhookRequestMock: vi.fn(),
  toRouteErrorResponseMock: vi.fn((error: unknown) => {
    const status =
      typeof error === "object" && error !== null && "status" in error
        ? Number(error.status)
        : 500;
    return Response.json(
      { error: status === 401 ? "Invalid HubSpot signature" : "Not available" },
      { status },
    );
  }),
}));

vi.mock("@scouting-platform/core", () => ({
  acceptHubspotWebhookDelivery: acceptHubspotWebhookDeliveryMock,
  verifyHubspotWebhookRequest: verifyHubspotWebhookRequestMock,
}));

vi.mock("../../../../../lib/api", () => ({
  toRouteErrorResponse: toRouteErrorResponseMock,
}));

import { POST } from "./route";

const HUBSPOT_WEBHOOK_MAX_RAW_BODY_BYTES = 1024 * 1024;

const rawDelivery = `[
  {
    "eventId": 9001,
    "subscriptionId": 55,
    "portalId": 123456,
    "occurredAt": 1784534400000,
    "subscriptionType": "contact.propertyChange",
    "objectId": 42,
    "propertyName": "email",
    "propertyValue": "creator@example.com"
  }
]`;

const genericRawDelivery = `[
  {
    "eventId": 9002,
    "subscriptionId": 56,
    "portalId": 123456,
    "occurredAt": 1784534400000,
    "subscriptionType": "object.propertyChange",
    "objectTypeId": "0-1",
    "objectId": 43,
    "propertyName": "email",
    "propertyValue": "generic@example.com"
  }
]`;

function requestFor(
  body = rawDelivery,
  headers: Record<string, string> = {},
): Request {
  return new Request(
    "http://web.internal:3000/api/integrations/hubspot/webhooks?source=push%2Fv3",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hubspot-signature-v3": "signed-value",
        "x-hubspot-request-timestamp": "1784534400000",
        ...headers,
      },
      body,
    },
  );
}

function streamingRequest(chunks: readonly Uint8Array[]): Request {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  return new Request(
    "http://web.internal:3000/api/integrations/hubspot/webhooks",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hubspot-signature-v3": "signed-value",
        "x-hubspot-request-timestamp": "1784534400000",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
}

function routeFailure(status: number, code: string): Error & {
  status: number;
  code: string;
} {
  return Object.assign(new Error("sensitive provider detail"), { status, code });
}

describe("HubSpot webhook delivery route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyHubspotWebhookRequestMock.mockReturnValue({ portalId: "123456" });
    acceptHubspotWebhookDeliveryMock.mockResolvedValue({
      accepted: 1,
      duplicates: 0,
    });
  });

  it("accepts a normal signed payload using the exact raw delivery bytes", async () => {
    const request = requestFor(rawDelivery, {
      "x-forwarded-host": "scouting.example.com",
      "x-forwarded-proto": "https",
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ accepted: 1, duplicates: 0 });
    expect(verifyHubspotWebhookRequestMock).toHaveBeenCalledWith({
      method: "POST",
      uri: "https://scouting.example.com/api/integrations/hubspot/webhooks?source=push%2Fv3",
      rawBody: rawDelivery,
      signature: "signed-value",
      timestamp: "1784534400000",
    });
    expect(acceptHubspotWebhookDeliveryMock).toHaveBeenCalledWith({
      expectedPortalId: "123456",
      events: [
        expect.objectContaining({
          eventId: "9001",
          portalId: "123456",
          objectId: "42",
          propertyName: "email",
        }),
      ],
    });
  });

  it("accepts the current generic object payload and preserves its object type ID", async () => {
    const response = await POST(requestFor(genericRawDelivery));

    expect(response.status).toBe(202);
    expect(acceptHubspotWebhookDeliveryMock).toHaveBeenCalledWith({
      expectedPortalId: "123456",
      events: [
        expect.objectContaining({
          eventId: "9002",
          subscriptionType: "object.propertyChange",
          objectTypeId: "0-1",
          objectId: "43",
        }),
      ],
    });
  });

  it("accepts an exact-boundary raw payload without altering signed bytes", async () => {
    const rawDeliveryBytes = new TextEncoder().encode(rawDelivery).byteLength;
    const boundaryBody = `${rawDelivery}${" ".repeat(
      HUBSPOT_WEBHOOK_MAX_RAW_BODY_BYTES - rawDeliveryBytes,
    )}`;
    const request = requestFor(boundaryBody, {
      "content-length": String(HUBSPOT_WEBHOOK_MAX_RAW_BODY_BYTES),
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    expect(verifyHubspotWebhookRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: boundaryBody }),
    );
    expect(
      new TextEncoder().encode(
        verifyHubspotWebhookRequestMock.mock.calls[0]?.[0].rawBody,
      ).byteLength,
    ).toBe(HUBSPOT_WEBHOOK_MAX_RAW_BODY_BYTES);
  });

  it("rejects an oversized declared Content-Length before signature verification", async () => {
    const response = await POST(
      requestFor(rawDelivery, {
        "content-length": String(HUBSPOT_WEBHOOK_MAX_RAW_BODY_BYTES + 1),
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "HubSpot webhook payload is too large",
    });
    expect(verifyHubspotWebhookRequestMock).not.toHaveBeenCalled();
    expect(acceptHubspotWebhookDeliveryMock).not.toHaveBeenCalled();
  });

  it("rejects a chunked body as soon as streamed raw bytes exceed the cap", async () => {
    const boundaryChunk = new Uint8Array(HUBSPOT_WEBHOOK_MAX_RAW_BODY_BYTES);
    boundaryChunk.fill(0x20);
    const request = streamingRequest([boundaryChunk, new Uint8Array([0x20])]);
    expect(request.headers.get("content-length")).toBeNull();

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "HubSpot webhook payload is too large",
    });
    expect(verifyHubspotWebhookRequestMock).not.toHaveBeenCalled();
    expect(acceptHubspotWebhookDeliveryMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid Content-Length before reading or verifying the body", async () => {
    const response = await POST(
      requestFor(rawDelivery, { "content-length": "12.5" }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Invalid Content-Length" });
    expect(verifyHubspotWebhookRequestMock).not.toHaveBeenCalled();
    expect(acceptHubspotWebhookDeliveryMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature without persisting the delivery", async () => {
    verifyHubspotWebhookRequestMock.mockImplementation(() => {
      throw routeFailure(401, "HUBSPOT_WEBHOOK_SIGNATURE_INVALID");
    });

    const response = await POST(requestFor());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid HubSpot signature" });
    expect(acceptHubspotWebhookDeliveryMock).not.toHaveBeenCalled();
  });

  it("rejects a replayed signed request without persisting the delivery", async () => {
    verifyHubspotWebhookRequestMock.mockImplementation(() => {
      throw routeFailure(401, "HUBSPOT_WEBHOOK_REPLAYED");
    });

    const response = await POST(requestFor());

    expect(response.status).toBe(401);
    expect(toRouteErrorResponseMock).toHaveBeenCalledWith(
      expect.objectContaining({ code: "HUBSPOT_WEBHOOK_REPLAYED" }),
    );
    expect(acceptHubspotWebhookDeliveryMock).not.toHaveBeenCalled();
  });

  it("rejects signed malformed JSON without calling core persistence", async () => {
    const response = await POST(requestFor("{not-json"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid HubSpot webhook payload",
    });
    expect(verifyHubspotWebhookRequestMock).toHaveBeenCalledOnce();
    expect(acceptHubspotWebhookDeliveryMock).not.toHaveBeenCalled();
  });

  it("rejects a signed payload that does not match the delivery contract", async () => {
    const response = await POST(requestFor(JSON.stringify([{ portalId: 123456 }])));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid HubSpot webhook payload");
    expect(acceptHubspotWebhookDeliveryMock).not.toHaveBeenCalled();
  });

  it("keeps the endpoint closed when the webhook feature is off", async () => {
    verifyHubspotWebhookRequestMock.mockImplementation(() => {
      throw routeFailure(404, "HUBSPOT_WEBHOOKS_DISABLED");
    });

    const response = await POST(requestFor());

    expect(response.status).toBe(404);
    expect(acceptHubspotWebhookDeliveryMock).not.toHaveBeenCalled();
  });

  it("ignores malformed partial forwarding metadata", async () => {
    const request = requestFor(rawDelivery, {
      "x-forwarded-host": "attacker.example/path",
      "x-forwarded-proto": "https",
    });

    await POST(request);

    expect(verifyHubspotWebhookRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: "http://web.internal:3000/api/integrations/hubspot/webhooks?source=push%2Fv3",
      }),
    );
  });
});
