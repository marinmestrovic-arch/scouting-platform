import { z } from "zod";

import {
  HubspotConfigError,
  resolveHubspotClientOptions,
} from "./config";
import type { HubspotClientOptions } from "./config";

export type { FetchLike, HubspotClientOptions, HubspotSleepFn } from "./config";

export type HubspotErrorCode =
  | "HUBSPOT_API_KEY_MISSING"
  | "HUBSPOT_CONFIG_INVALID"
  | "HUBSPOT_INVALID_INPUT"
  | "HUBSPOT_AUTH_FAILED"
  | "HUBSPOT_RATE_LIMITED"
  | "HUBSPOT_TIMEOUT"
  | "HUBSPOT_NETWORK_ERROR"
  | "HUBSPOT_INVALID_RESPONSE"
  | "HUBSPOT_REQUEST_FAILED";

export type HubspotErrorDetails = Readonly<{
  retryable?: boolean;
  correlationId?: string | null;
  retryAfterMs?: number | null;
}>;

export class HubspotError extends Error {
  readonly code: HubspotErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly correlationId: string | null;
  readonly retryAfterMs: number | null;

  constructor(
    code: HubspotErrorCode,
    status: number,
    message: string,
    details: HubspotErrorDetails = {},
  ) {
    super(message);
    this.name = "HubspotError";
    this.code = code;
    this.status = status;
    this.retryable = details.retryable ?? false;
    this.correlationId = details.correlationId ?? null;
    this.retryAfterMs = details.retryAfterMs ?? null;
  }
}

export function isHubspotError(error: unknown): error is HubspotError {
  return error instanceof HubspotError;
}

export function parseRetryAfterMs(
  value: string | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }
  const dateMs = Date.parse(normalized);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  return Math.max(0, dateMs - nowMs);
}

export type HubspotRequestInput<TSchema extends z.ZodType> = HubspotClientOptions &
  Readonly<{
    path: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    responseSchema: TSchema;
    acceptedStatuses?: readonly number[];
  }>;

const providerErrorMetadataSchema = z.object({
  correlationId: z.string().optional(),
});

function safeCorrelationId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

async function readProviderErrorMetadata(response: Response): Promise<{
  correlationId: string | null;
  retryAfterMs: number | null;
}> {
  let bodyCorrelationId: string | null = null;
  try {
    const text = await response.text();
    if (text) {
      const parsedJson: unknown = JSON.parse(text);
      const parsed = providerErrorMetadataSchema.safeParse(parsedJson);
      if (parsed.success) {
        bodyCorrelationId = safeCorrelationId(parsed.data.correlationId);
      }
    }
  } catch {
    // Provider error bodies are optional and are never surfaced verbatim.
  }
  return {
    correlationId:
      safeCorrelationId(response.headers.get("x-hubspot-correlation-id")) ?? bodyCorrelationId,
    retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")),
  };
}

function toHttpError(
  response: Response,
  details: { correlationId: string | null; retryAfterMs: number | null },
): HubspotError {
  const common = {
    correlationId: details.correlationId,
    retryAfterMs: details.retryAfterMs,
  };
  if (response.status === 401 || response.status === 403) {
    return new HubspotError(
      "HUBSPOT_AUTH_FAILED",
      response.status,
      "HubSpot credentials are invalid or unauthorized",
      { ...common, retryable: false },
    );
  }
  if (response.status === 429) {
    return new HubspotError(
      "HUBSPOT_RATE_LIMITED",
      429,
      "HubSpot rate limit exceeded",
      { ...common, retryable: true },
    );
  }
  if (response.status === 408) {
    return new HubspotError("HUBSPOT_TIMEOUT", 408, "HubSpot request timed out", {
      ...common,
      retryable: true,
    });
  }
  const retryable = response.status === 423 || response.status >= 500;
  return new HubspotError(
    "HUBSPOT_REQUEST_FAILED",
    response.status,
    "HubSpot request failed",
    {
      ...common,
      retryAfterMs:
        response.status === 423
          ? Math.max(details.retryAfterMs ?? 0, 2_000)
          : details.retryAfterMs,
      retryable,
    },
  );
}

function retryDelayMs(
  retryIndex: number,
  retryAfterMs: number | null,
  baseDelayMs: number,
  maxRetryDelayMs: number,
  randomFn: () => number,
): number {
  const random = Math.min(1, Math.max(0, randomFn()));
  const exponential = baseDelayMs * 2 ** retryIndex;
  const jittered = Math.round(exponential * (0.5 + random * 0.5));
  // The configured cap bounds our own exponential backoff. A provider
  // Retry-After is authoritative and must remain a floor; retrying earlier
  // would immediately violate the rate-limit/lock window.
  return Math.max(Math.min(maxRetryDelayMs, jittered), retryAfterMs ?? 0);
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      const error = new Error("HubSpot request timed out");
      error.name = "AbortError";
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetchFn(url, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
  } catch (error) {
    if (timedOut && error instanceof Error) {
      error.name = "AbortError";
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function resolveOptions(input: HubspotClientOptions) {
  try {
    return resolveHubspotClientOptions(input);
  } catch (error) {
    if (error instanceof HubspotConfigError) {
      if (error.code === "HUBSPOT_ACCESS_TOKEN_MISSING") {
        throw new HubspotError(
          "HUBSPOT_API_KEY_MISSING",
          500,
          "HUBSPOT_ACCESS_TOKEN or legacy HUBSPOT_API_KEY is required",
          { retryable: false },
        );
      }
      throw new HubspotError("HUBSPOT_CONFIG_INVALID", 500, error.message, {
        retryable: false,
      });
    }
    throw error;
  }
}

export async function hubspotRequest<TSchema extends z.ZodType>(
  input: HubspotRequestInput<TSchema>,
): Promise<z.output<TSchema>> {
  const options = resolveOptions(input);
  const url = new URL(input.path, options.baseUrl);
  const method = input.method ?? "GET";
  const headers: Record<string, string> = {
    authorization: `Bearer ${options.accessToken}`,
    accept: "application/json",
  };
  let body: string | undefined;
  if (typeof input.body !== "undefined") {
    headers["content-type"] = "application/json";
    body = JSON.stringify(input.body);
  }

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        options.fetchFn,
        url,
        { method, headers, ...(typeof body === "string" ? { body } : {}) },
        options.timeoutMs,
      );
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      const normalized = new HubspotError(
        timedOut ? "HUBSPOT_TIMEOUT" : "HUBSPOT_NETWORK_ERROR",
        timedOut ? 504 : 502,
        timedOut ? "HubSpot request timed out" : "HubSpot network request failed",
        { retryable: true },
      );
      if (attempt >= options.maxRetries) {
        throw normalized;
      }
      await options.sleepFn(
        retryDelayMs(
          attempt,
          null,
          options.baseDelayMs,
          options.maxRetryDelayMs,
          options.randomFn,
        ),
      );
      continue;
    }

    if (response.ok || input.acceptedStatuses?.includes(response.status) === true) {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new HubspotError(
          "HUBSPOT_INVALID_RESPONSE",
          502,
          "HubSpot returned invalid JSON",
          { retryable: false },
        );
      }
      const parsed = input.responseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new HubspotError(
          "HUBSPOT_INVALID_RESPONSE",
          502,
          "HubSpot returned an invalid response",
          { retryable: false },
        );
      }
      return parsed.data;
    }

    const metadata = await readProviderErrorMetadata(response);
    const normalized = toHttpError(response, {
      correlationId: metadata.correlationId,
      retryAfterMs: parseRetryAfterMs(
        response.headers.get("retry-after"),
        options.nowFn(),
      ),
    });
    if (!normalized.retryable || attempt >= options.maxRetries) {
      throw normalized;
    }
    await options.sleepFn(
      retryDelayMs(
        attempt,
        normalized.retryAfterMs,
        options.baseDelayMs,
        options.maxRetryDelayMs,
        options.randomFn,
      ),
    );
  }

  throw new HubspotError(
    "HUBSPOT_REQUEST_FAILED",
    502,
    "HubSpot request retry budget was exhausted",
    { retryable: true },
  );
}
