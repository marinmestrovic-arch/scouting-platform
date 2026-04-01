// @ts-nocheck
/**
 * Provider Adapter Pattern
 *
 * This pattern demonstrates the required structure for external provider clients.
 * Copy and adapt for new provider integrations.
 *
 * Requirements enforced:
 * 1. All provider calls go through backend/packages/integrations
 * 2. Never expose provider secrets
 * 3. Retry with bounded backoff
 * 4. Normalize errors to domain-specific types
 * 5. Return typed responses, not raw API shapes
 * 6. Rate limit awareness
 *
 * Location: backend/packages/integrations/src/{provider}/...
 */

import { z } from "zod";

// ============================================================================
// 1. CONFIGURATION
// Load from environment, never hardcode secrets.
// ============================================================================

interface HypeAuditorConfig {
  authId: string;
  authToken: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

function loadConfig(): HypeAuditorConfig {
  const apiKey = process.env.HYPEAUDITOR_API_KEY;

  if (!apiKey || !apiKey.includes(":")) {
    throw new Error("HYPEAUDITOR_API_KEY must be set as auth_id:auth_token");
  }

  const [authId, authToken] = apiKey.split(":");

  return {
    authId,
    authToken,
    baseUrl: process.env.HYPEAUDITOR_BASE_URL || "https://hypeauditor.com/api",
    timeoutMs: 30_000,
    maxRetries: 3,
  };
}

// ============================================================================
// 2. ERROR TYPES
// Normalize provider errors to domain-specific types for consistent handling.
// ============================================================================

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly isRetryable: boolean,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type ProviderErrorCode =
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "NOT_FOUND"
  | "REPORT_NOT_READY"
  | "VALIDATION_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNKNOWN";

function normalizeError(error: unknown, statusCode?: number): ProviderError {
  // Rate limit
  if (statusCode === 429) {
    return new ProviderError(
      "HypeAuditor rate limit exceeded",
      "RATE_LIMITED",
      true, // Retryable after backoff
      error
    );
  }

  // Auth failure
  if (statusCode === 401 || statusCode === 403) {
    return new ProviderError(
      "HypeAuditor authentication failed",
      "AUTH_FAILED",
      false, // Not retryable - config issue
      error
    );
  }

  // Not found
  if (statusCode === 404) {
    return new ProviderError(
      "Channel not found in HypeAuditor",
      "NOT_FOUND",
      false,
      error
    );
  }

  // Report still processing
  if (statusCode === 202) {
    return new ProviderError(
      "HypeAuditor report not ready yet",
      "REPORT_NOT_READY",
      true, // Retry later
      error
    );
  }

  // Timeout
  if (error instanceof Error && error.name === "AbortError") {
    return new ProviderError(
      "HypeAuditor request timed out",
      "TIMEOUT",
      true,
      error
    );
  }

  // Network error
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return new ProviderError(
      "Network error connecting to HypeAuditor",
      "NETWORK_ERROR",
      true,
      error
    );
  }

  // Unknown
  return new ProviderError(
    `HypeAuditor error: ${error instanceof Error ? error.message : String(error)}`,
    "UNKNOWN",
    false,
    error
  );
}

// ============================================================================
// 3. RESPONSE SCHEMAS
// Validate provider responses. Never trust external APIs.
// ============================================================================

const HypeAuditorChannelResponseSchema = z.object({
  data: z.object({
    channel_id: z.string(),
    subscriber_count: z.number(),
    avg_views: z.number().optional(),
    engagement_rate: z.number().optional(),
    audience: z
      .object({
        countries: z.array(
          z.object({
            code: z.string(),
            percentage: z.number(),
          })
        ).optional(),
        gender: z
          .object({
            male: z.number(),
            female: z.number(),
          })
          .optional(),
        age_groups: z
          .array(
            z.object({
              range: z.string(),
              percentage: z.number(),
            })
          )
          .optional(),
      })
      .optional(),
    brand_mentions: z.array(z.string()).optional(),
    estimated_price: z
      .object({
        min: z.number(),
        max: z.number(),
        currency: z.string(),
      })
      .optional(),
  }),
});

type HypeAuditorChannelResponse = z.infer<typeof HypeAuditorChannelResponseSchema>;

// ============================================================================
// 4. NORMALIZED DOMAIN TYPES
// Return these from adapter, not raw API shapes.
// ============================================================================

export interface ChannelInsights {
  channelId: string;
  subscriberCount: number;
  averageViews: number | null;
  engagementRate: number | null;
  audience: {
    topCountries: Array<{ code: string; percentage: number }>;
    genderSplit: { male: number; female: number } | null;
    ageGroups: Array<{ range: string; percentage: number }>;
  };
  brandMentions: string[];
  estimatedPrice: {
    min: number;
    max: number;
    currency: string;
  } | null;
  fetchedAt: Date;
}

function toChannelInsights(raw: HypeAuditorChannelResponse): ChannelInsights {
  const data = raw.data;

  return {
    channelId: data.channel_id,
    subscriberCount: data.subscriber_count,
    averageViews: data.avg_views ?? null,
    engagementRate: data.engagement_rate ?? null,
    audience: {
      topCountries: data.audience?.countries ?? [],
      genderSplit: data.audience?.gender ?? null,
      ageGroups: data.audience?.age_groups ?? [],
    },
    brandMentions: data.brand_mentions ?? [],
    estimatedPrice: data.estimated_price
      ? {
          min: data.estimated_price.min,
          max: data.estimated_price.max,
          currency: data.estimated_price.currency,
        }
      : null,
    fetchedAt: new Date(),
  };
}

// ============================================================================
// 5. RETRY HELPER
// Bounded exponential backoff for retryable errors.
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: ProviderError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ProviderError) {
        lastError = error;

        if (!error.isRetryable || attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s, ...
        const delay = baseDelayMs * Math.pow(2, attempt);
        console.log(
          `[HypeAuditor] Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${error.code}`
        );
        await sleep(delay);
      } else {
        // Unexpected error, normalize and throw
        throw normalizeError(error);
      }
    }
  }

  throw lastError || new ProviderError("Max retries exceeded", "UNKNOWN", false);
}

// ============================================================================
// 6. ADAPTER CLASS
// Main entry point for provider calls.
// ============================================================================

export class HypeAuditorAdapter {
  private config: HypeAuditorConfig;

  constructor() {
    this.config = loadConfig();
  }

  /**
   * Fetch channel insights from HypeAuditor.
   *
   * @param youtubeChannelId - The YouTube channel ID
   * @returns Normalized channel insights
   * @throws ProviderError on failure
   */
  async fetchChannelInsights(youtubeChannelId: string): Promise<ChannelInsights> {
    return withRetry(
      () => this.doFetchChannelInsights(youtubeChannelId),
      this.config.maxRetries
    );
  }

  private async doFetchChannelInsights(
    youtubeChannelId: string
  ): Promise<ChannelInsights> {
    const url = `${this.config.baseUrl}/channel/${youtubeChannelId}/report`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "X-Auth-Id": this.config.authId,
          "X-Auth-Token": this.config.authToken,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Handle non-200 responses
      if (!response.ok) {
        throw normalizeError(
          new Error(`HTTP ${response.status}`),
          response.status
        );
      }

      // Handle 202 (report processing)
      if (response.status === 202) {
        throw normalizeError(null, 202);
      }

      // Parse and validate response
      const rawJson = await response.json();

      const parseResult = HypeAuditorChannelResponseSchema.safeParse(rawJson);

      if (!parseResult.success) {
        throw new ProviderError(
          `Invalid HypeAuditor response: ${parseResult.error.message}`,
          "VALIDATION_ERROR",
          false,
          parseResult.error
        );
      }

      // Transform to domain type
      return toChannelInsights(parseResult.data);
    } catch (error) {
      clearTimeout(timeout);

      // Re-throw if already a ProviderError
      if (error instanceof ProviderError) {
        throw error;
      }

      // Normalize other errors
      throw normalizeError(error);
    }
  }
}

// ============================================================================
// 7. SINGLETON EXPORT
// Use a single instance to share config/connection state.
// ============================================================================

let instance: HypeAuditorAdapter | null = null;

export function getHypeAuditorAdapter(): HypeAuditorAdapter {
  if (!instance) {
    instance = new HypeAuditorAdapter();
  }
  return instance;
}

// ============================================================================
// PATTERN CHECKLIST
// ============================================================================
//
// Before merging a new provider adapter, verify:
//
// □ Adapter lives in backend/packages/integrations
// □ Secrets loaded from environment, never hardcoded
// □ Secrets never logged or returned in errors
// □ Response validated with zod schema
// □ Errors normalized to ProviderError with code + isRetryable
// □ Retry logic with bounded exponential backoff
// □ Timeout configured and enforced
// □ Rate limit errors identified and marked retryable
// □ Domain types returned, not raw API shapes
// □ Unit tests mock HTTP layer and cover all error codes
// □ No browser-accessible exports (this is backend-only)
//
// ============================================================================
