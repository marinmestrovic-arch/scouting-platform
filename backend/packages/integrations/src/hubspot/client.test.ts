import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { HubspotError, hubspotRequest, parseRetryAfterMs } from "./client";

const responseSchema = z.object({
  id: z.string(),
});

describe("hubspotRequest", () => {
  it("adds Bearer authentication and validates a successful response", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "contact-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await hubspotRequest({
      accessToken: "private-access-token",
      baseUrl: "https://hubspot.test",
      fetchFn,
      maxRetries: 0,
      path: "/crm/objects/2026-03/contacts/contact-1",
      responseSchema,
    });

    expect(result).toEqual({ id: "contact-1" });
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe(
      "https://hubspot.test/crm/objects/2026-03/contacts/contact-1",
    );
    const headers = new Headers(fetchFn.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer private-access-token");
    expect(headers.get("accept")).toBe("application/json");
  });

  it("honors Retry-After before retrying a rate-limited request", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ correlationId: "rate-correlation" }), {
          status: 429,
          headers: { "retry-after": "2" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "contact-2" }), { status: 200 }),
      );
    const sleepFn = vi.fn(async (milliseconds: number) => {
      void milliseconds;
    });

    const result = await hubspotRequest({
      accessToken: "access-token",
      fetchFn,
      sleepFn,
      randomFn: () => 0,
      baseDelayMs: 100,
      maxRetries: 1,
      path: "/crm/objects/2026-03/contacts/contact-2",
      responseSchema,
    });

    expect(result.id).toBe("contact-2");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledOnce();
    expect(sleepFn).toHaveBeenCalledWith(2_000);
  });

  it("does not cap a provider Retry-After at the local backoff ceiling", async () => {
    const responses = [
      new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "60" },
      }),
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];
    const fetchFn = vi.fn(async () => responses.shift()!);
    const sleepFn = vi.fn(async () => undefined);

    await hubspotRequest({
      accessToken: "test-token",
      path: "/test",
      fetchFn: fetchFn as typeof fetch,
      sleepFn,
      maxRetries: 1,
      maxRetryDelayMs: 30_000,
      responseSchema: z.object({ ok: z.boolean() }),
    });

    expect(sleepFn).toHaveBeenCalledWith(60_000);
  });

  it("parses both Retry-After formats", () => {
    const nowMs = Date.parse("2026-07-20T12:00:00.000Z");

    expect(parseRetryAfterMs("1.5", nowMs)).toBe(1_500);
    expect(parseRetryAfterMs("Mon, 20 Jul 2026 12:00:03 GMT", nowMs)).toBe(3_000);
    expect(parseRetryAfterMs("invalid", nowMs)).toBeNull();
  });

  it("retries server failures with bounded exponential backoff", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("still unavailable", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "deal-1" }), { status: 200 }),
      );
    const sleepFn = vi.fn(async (milliseconds: number) => {
      void milliseconds;
    });

    await expect(
      hubspotRequest({
        accessToken: "access-token",
        fetchFn,
        sleepFn,
        randomFn: () => 0,
        baseDelayMs: 100,
        maxRetryDelayMs: 75,
        maxRetries: 2,
        path: "/crm/objects/2026-03/deals/batch/upsert",
        method: "POST",
        body: { inputs: [] },
        responseSchema,
      }),
    ).resolves.toEqual({ id: "deal-1" });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleepFn.mock.calls).toEqual([[50], [75]]);
  });

  it("retries network failures without surfacing the original exception", async () => {
    const providerMessage = "fetch failed with private-access-token";
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError(providerMessage))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "contact-3" }), { status: 200 }),
      );
    const sleepFn = vi.fn(async (milliseconds: number) => {
      void milliseconds;
    });

    await expect(
      hubspotRequest({
        accessToken: "private-access-token",
        fetchFn,
        sleepFn,
        maxRetries: 1,
        path: "/crm/objects/2026-03/contacts/contact-3",
        responseSchema,
      }),
    ).resolves.toEqual({ id: "contact-3" });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledOnce();
  });

  it.each([408, 423])("retries retryable HTTP status %i", async (status) => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("retry", { status }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: `record-${status}` }), { status: 200 }),
      );

    await expect(
      hubspotRequest({
        accessToken: "access-token",
        fetchFn,
        sleepFn: async () => undefined,
        maxRetries: 1,
        path: "/crm/objects/2026-03/contacts/batch/upsert",
        responseSchema,
      }),
    ).resolves.toEqual({ id: `record-${status}` });
  });

  it("aborts and normalizes a timed-out request", async () => {
    const observed: { signal?: AbortSignal | null } = {};
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>(() => {
          observed.signal = init?.signal ?? null;
        }),
    );

    await expect(
      hubspotRequest({
        accessToken: "access-token",
        fetchFn,
        timeoutMs: 5,
        maxRetries: 0,
        path: "/crm/objects/2026-03/contacts/contact-timeout",
        responseSchema,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_TIMEOUT",
      status: 504,
      retryable: true,
    } satisfies Partial<HubspotError>);

    expect(observed.signal?.aborted).toBe(true);
  });

  it("rejects malformed success payloads without retrying", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ missingId: true }), { status: 200 }),
    );
    const sleepFn = vi.fn(async (milliseconds: number) => {
      void milliseconds;
    });

    await expect(
      hubspotRequest({
        accessToken: "access-token",
        fetchFn,
        sleepFn,
        maxRetries: 3,
        path: "/crm/objects/2026-03/contacts/contact-invalid",
        responseSchema,
      }),
    ).rejects.toMatchObject({
      code: "HUBSPOT_INVALID_RESPONSE",
      status: 502,
      retryable: false,
    } satisfies Partial<HubspotError>);

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it("keeps provider bodies and credentials out of normalized errors", async () => {
    const secret = "private-access-token";
    const providerSecret = "provider-body-secret";
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          correlationId: "safe-correlation-123",
          message: providerSecret,
          token: secret,
        }),
        { status: 400 },
      ),
    );

    let error: unknown;
    try {
      await hubspotRequest({
        accessToken: secret,
        fetchFn,
        maxRetries: 0,
        path: "/crm/objects/2026-03/contacts/contact-error",
        responseSchema,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(HubspotError);
    expect(error).toMatchObject({
      code: "HUBSPOT_REQUEST_FAILED",
      status: 400,
      retryable: false,
      correlationId: "safe-correlation-123",
      retryAfterMs: null,
      message: "HubSpot request failed",
    });
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain(providerSecret);
  });
});
