# Codex Implementation Guide: Provider Spend Hardening

- Status: In Progress
- Source plan: `docs/plans/2026-03-provider-spend-hardening-plan.md`
- Date: 2026-04-01
- Owner: Ivan

## Progress

- 2026-04-01: Session 1 implemented by Codex.
- 2026-04-01: Session 2 implemented by Codex.
- 2026-04-01: Session 3 implemented by Codex.
- Completed in code:
  - Prisma schema additions for advanced report retry markers, enrichment attempt markers, and `YoutubeDiscoveryCache`
  - Migration SQL files for the additive columns and discovery cache table
  - OpenAI prompt slimming in `backend/packages/integrations/src/openai/channel-enrichment.ts`
  - Migration safety coverage and OpenAI adapter test coverage for the slimmed prompt
  - Retry-aware HypeAuditor execution that persists provider payloads before the final merge transaction and reuses them across retries
  - Retry-aware YouTube/OpenAI enrichment execution that persists intermediate provider state and reuses stored payloads on retry
  - Session 2 integration coverage for HypeAuditor cooldown/reuse paths and enrichment attempt-marker reuse/reset paths
  - DB-backed YouTube discovery cache with per-user hashed cache keys and configurable TTL
  - Structured provider spend telemetry across HypeAuditor, YouTube context, OpenAI, and YouTube discovery paths
  - Session 3 week 3 integration coverage for discovery cache hits, expiry, and cache persistence
- Verified:
  - `pnpm --filter @scouting-platform/db exec vitest run src/migrations.test.ts`
  - `pnpm --filter @scouting-platform/integrations exec vitest run src/openai/channel-enrichment.test.ts`
  - `pnpm --filter @scouting-platform/db typecheck`
  - `pnpm --filter @scouting-platform/integrations typecheck`
  - `pnpm --filter @scouting-platform/integrations exec vitest run src/openai/channel-enrichment.test.ts src/hypeauditor/report.test.ts`
  - `pnpm --filter @scouting-platform/core typecheck`
  - `pnpm --filter @scouting-platform/core exec vitest run src/week3.integration.test.ts src/week4.integration.test.ts src/week5.integration.test.ts`
- Pending local verification:
  - `pnpm db:migrate` could not be completed in this worktree because `DATABASE_URL` was not set
  - `backend/packages/db/src/postgres.integration.test.ts` skipped because `DATABASE_URL_TEST` was not set
  - `backend/packages/core/src/week3.integration.test.ts`, `backend/packages/core/src/week4.integration.test.ts`, and `backend/packages/core/src/week5.integration.test.ts` were present and updated, but skipped because `DATABASE_URL_TEST` was not set

This document is the implementation handoff for Codex. It is split into three sessions that must be
executed in order. Each session is self-contained and testable before the next begins.

---

## Constraints (apply to all sessions)

- Postgres/Prisma only — no new runtime dependencies
- No user-visible behavior changes
- Do not change freshness windows: 120-day HypeAuditor, 14-day YouTube context, 14-day enrichment
- Do not change queue family names, approval semantics, or worker/web topology
- Do not rename or remove existing exports
- `toJsonValue` already exists as a private function in `approvals/index.ts` and `enrichment/index.ts` — reuse the same pattern, do not import from a shared location
- `isYoutubeDiscoveryProviderError` is already imported in `runs/repository.ts` — do not re-import

---

## Session 1 — Schema + Prompt Slimming

Status: Completed on 2026-04-01

**Scope:** Two Prisma migrations + OpenAI prompt changes. No execution logic changes.

### 1A. Prisma schema changes

File: `backend/packages/db/prisma/schema.prisma`

Add three nullable columns to the `AdvancedReportRequest` model, after the `lastError` field:

```prisma
providerFetchedAt     DateTime?  @map("provider_fetched_at")
lastProviderAttemptAt DateTime?  @map("last_provider_attempt_at")
nextProviderAttemptAt DateTime?  @map("next_provider_attempt_at")
```

Add two nullable columns to the `ChannelEnrichment` model, after the `rawOpenaiPayload` field:

```prisma
rawOpenaiPayloadFetchedAt DateTime?  @map("raw_openai_payload_fetched_at")
youtubeFetchedAt          DateTime?  @map("youtube_fetched_at")
```

Add a new model at the end of the schema file (before the closing of the file):

```prisma
model YoutubeDiscoveryCache {
  id         String   @id @default(uuid()) @db.Uuid
  cacheKey   String   @unique @map("cache_key")
  userId     String   @map("user_id") @db.Uuid
  query      String
  maxResults Int      @map("max_results")
  payload    Json
  fetchedAt  DateTime @map("fetched_at")
  expiresAt  DateTime @map("expires_at")
  createdAt  DateTime @default(now()) @map("created_at")
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([cacheKey], map: "youtube_discovery_cache_cache_key_idx")
  @@index([expiresAt], map: "youtube_discovery_cache_expires_at_idx")
  @@map("youtube_discovery_cache")
}
```

Also add `youtubeDiscoveryCache YoutubeDiscoveryCache[]` to the `User` model's relation list.

### 1B. Migration files

Create directory and file:
`backend/packages/db/prisma/migrations/20260401120000_provider_spend_hardening_columns/migration.sql`

```sql
ALTER TABLE "advanced_report_requests"
  ADD COLUMN "provider_fetched_at"      TIMESTAMP(3),
  ADD COLUMN "last_provider_attempt_at" TIMESTAMP(3),
  ADD COLUMN "next_provider_attempt_at" TIMESTAMP(3);

ALTER TABLE "channel_enrichments"
  ADD COLUMN "raw_openai_payload_fetched_at" TIMESTAMP(3),
  ADD COLUMN "youtube_fetched_at"            TIMESTAMP(3);
```

Create directory and file:
`backend/packages/db/prisma/migrations/20260401130000_youtube_discovery_cache/migration.sql`

```sql
CREATE TABLE "youtube_discovery_cache" (
  "id"          UUID         NOT NULL,
  "cache_key"   TEXT         NOT NULL,
  "user_id"     UUID         NOT NULL,
  "query"       TEXT         NOT NULL,
  "max_results" INTEGER      NOT NULL,
  "payload"     JSONB        NOT NULL,
  "fetched_at"  TIMESTAMP(3) NOT NULL,
  "expires_at"  TIMESTAMP(3) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "youtube_discovery_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "youtube_discovery_cache_cache_key_key"
  ON "youtube_discovery_cache"("cache_key");

CREATE INDEX "youtube_discovery_cache_cache_key_idx"
  ON "youtube_discovery_cache"("cache_key");

CREATE INDEX "youtube_discovery_cache_expires_at_idx"
  ON "youtube_discovery_cache"("expires_at");

ALTER TABLE "youtube_discovery_cache"
  ADD CONSTRAINT "youtube_discovery_cache_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
```

### 1C. OpenAI prompt slimming

File: `backend/packages/integrations/src/openai/channel-enrichment.ts`

Add a private helper function immediately before `buildPrompt`:

```typescript
function slimYoutubeContext(ctx: z.output<typeof inputSchema>["youtubeContext"]): {
  youtubeChannelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  recentVideos: {
    youtubeVideoId: string | null;
    title: string;
    description: string | null;
    publishedAt: string | null;
    viewCount: number | null;
    likeCount: number | null;
    commentCount: number | null;
  }[];
} {
  return {
    youtubeChannelId: ctx.youtubeChannelId,
    title: ctx.title,
    handle: ctx.handle,
    thumbnailUrl: ctx.thumbnailUrl,
    publishedAt: ctx.publishedAt,
    subscriberCount: ctx.subscriberCount,
    viewCount: ctx.viewCount,
    videoCount: ctx.videoCount,
    recentVideos: ctx.recentVideos.slice(0, 5).map((v) => ({
      youtubeVideoId: v.youtubeVideoId,
      title: v.title,
      description: v.description ? v.description.slice(0, 200) : null,
      publishedAt: v.publishedAt,
      viewCount: v.viewCount ?? null,
      likeCount: v.likeCount ?? null,
      commentCount: v.commentCount ?? null,
    })),
  };
}
```

Update `buildPrompt` to use compact JSON and the slim context:

```typescript
function buildPrompt(input: z.output<typeof inputSchema>): string {
  return JSON.stringify({
    channel: input.channel,
    youtubeContext: slimYoutubeContext(input.youtubeContext),
    instructions: {
      summary:
        "Write a concise summary of the creator's content style, audience, and positioning.",
      topics: "List the main repeatable content topics as short tags.",
      brandFitNotes:
        "Explain the most relevant sponsor/brand fit observations, including constraints if visible.",
      confidence:
        "Return a number from 0 to 1 reflecting confidence in the profile quality from this context.",
    },
  });
}
```

What changed vs current:
- Removed `null, 2` from `JSON.stringify` (compact output, fewer tokens)
- `youtubeContext.description` dropped (duplicate of `channel.description`)
- `youtubeContext.diagnostics` dropped (internal QA field, not needed by LLM)
- `recentVideos` capped at 5 (was up to 10)
- Each video `description` trimmed to 200 chars

The output schema and zod parsing are unchanged.

### 1D. Tests for prompt slimming

File: `backend/packages/integrations/src/openai/channel-enrichment.test.ts`

Add a test case verifying that `enrichChannelWithOpenAi` sends a compact, slimmed prompt:
- Provide a `youtubeContext` with `diagnostics.warnings: ["some warning"]`, `description` set,
  more than 5 `recentVideos`, and at least one video with `description` longer than 200 characters.
- Capture the `messages[1].content` string passed to the mocked `openai.chat.completions.create`.
- Assert:
  - The string does not contain `"diagnostics"`
  - Parsed `JSON.parse(content).youtubeContext` has no `description` key
  - `recentVideos.length <= 5`
  - No `recentVideos[n].description` value exceeds 200 characters
  - `content` is valid compact JSON (no leading whitespace inside the first `{`)

### Session 1 verification

```bash
cd backend/packages/db && npx prisma migrate dev
cd backend && npx tsc --noEmit
cd backend/packages/integrations && npx vitest run openai/channel-enrichment
```

---

## Session 2 — Execution Hardening (HypeAuditor + OpenAI + YouTube Context)

Status: Completed on 2026-04-01

**Scope:** Phase-split execution in `approvals/index.ts` and `enrichment/index.ts`. Requires Session 1
migrations to be applied first.

### 2A. HypeAuditor retry hardening

File: `backend/packages/core/src/approvals/index.ts`

Restructure `executeAdvancedReportRequest`. The function currently:
1. Claims the row atomically (QUEUED|FAILED → RUNNING)
2. Always calls `fetchHypeAuditorChannelInsights`
3. Creates `channelProviderPayload` row inside the insight-merge transaction
4. Updates request to COMPLETED with `providerPayloadId` inside the same transaction

Change it to the following phases:

**Phase 1 — Claim (unchanged)**  
Keep the existing `updateMany` guard (QUEUED|FAILED → RUNNING).

**Phase 2 — Load execution state**  
Expand the select that loads the execution row after claiming to include:
```typescript
providerPayloadId: true,
providerFetchedAt: true,
nextProviderAttemptAt: true,
```

**Phase 3 — Conditional HypeAuditor call**  
Add before the existing HypeAuditor call block:

```typescript
if (executionState.providerPayloadId !== null) {
  // Provider payload already persisted — skip directly to Phase 4
} else {
  const now = new Date();

  // Cooldown check
  if (
    executionState.nextProviderAttemptAt !== null &&
    executionState.nextProviderAttemptAt > now
  ) {
    await prisma.advancedReportRequest.update({
      where: { id: executionState.id },
      data: {
        status: PrismaAdvancedReportRequestStatus.FAILED,
        lastError: "HypeAuditor cooldown active — retry after nextProviderAttemptAt",
      },
    });
    throw new ServiceError(
      "HYPEAUDITOR_COOLDOWN_ACTIVE",
      429,
      "HypeAuditor cooldown active",
    );
  }

  // Record attempt timestamp
  await prisma.advancedReportRequest.update({
    where: { id: executionState.id },
    data: { lastProviderAttemptAt: now },
  });

  // HypeAuditor call (keep existing try/catch error-wrapping logic)
  // On HYPEAUDITOR_REPORT_NOT_READY, replace the existing re-throw with:
  //   await prisma.advancedReportRequest.update({
  //     where: { id: executionState.id },
  //     data: {
  //       status: PrismaAdvancedReportRequestStatus.FAILED,
  //       lastError: error.message,
  //       nextProviderAttemptAt: new Date(Date.now() + 5 * 60 * 1000),
  //     },
  //   });
  //   throw new ServiceError(error.code, error.status, error.message);
  // (handled before the generic re-throw)

  // After successful HypeAuditor call:
  // 1. Create channelProviderPayload row (same as current)
  const providerPayload = await prisma.channelProviderPayload.create({ ... });

  // 2. Persist payload link as a separate write (NOT inside the final transaction)
  await prisma.advancedReportRequest.update({
    where: { id: executionState.id },
    data: {
      providerPayloadId: providerPayload.id,
      providerFetchedAt: new Date(),
      nextProviderAttemptAt: null,
    },
  });
}
```

**Phase 4 — Insight merge (unconditional)**  
Replace the current transaction that both creates the payload row AND merges insights with one
that only merges insights (payload row was created in Phase 3):

Add a private helper function above `executeAdvancedReportRequest`:

```typescript
function deriveInsightsFromRawPayload(
  rawPayload: Prisma.JsonValue,
): HypeAuditorChannelInsights {
  // Parse the stored JSON into the typed insights shape.
  // Use the same field-extraction logic currently applied to the live API response.
  // Throw ServiceError("HYPEAUDITOR_INVALID_STORED_PAYLOAD", 500) if parsing fails.
}
```

Load the persisted payload before the transaction:

```typescript
const payloadRow = await prisma.channelProviderPayload.findUniqueOrThrow({
  where: { id: executionState.providerPayloadId! },
  select: { payload: true },
});
const insights = deriveInsightsFromRawPayload(payloadRow.payload);
```

Then run the existing insight-merge transaction using `insights`, without creating a new payload
row inside it. The `providerPayloadId` is already set on the request row.

**Top-level catch guard**  
The existing catch block sets FAILED. Guard it so it does not double-write for errors that already
updated status before rethrowing:

```typescript
} catch (error) {
  const alreadyHandled =
    error instanceof ServiceError &&
    (error.code === "HYPEAUDITOR_REPORT_NOT_READY" ||
      error.code === "HYPEAUDITOR_COOLDOWN_ACTIVE");

  if (!alreadyHandled) {
    await prisma.advancedReportRequest.update({
      where: { id: input.advancedReportRequestId },
      data: {
        status: PrismaAdvancedReportRequestStatus.FAILED,
        lastError: formatErrorMessage(error),
      },
    });
  }
  throw error;
}
```

### 2B. OpenAI + YouTube context idempotency

File: `backend/packages/core/src/enrichment/index.ts`

Restructure `executeChannelLlmEnrichment`. The function currently:
1. Claims the row (QUEUED|FAILED|STALE → RUNNING)
2. Calls `refreshYoutubeContext` (uses 14-day cache)
3. Derives YouTube metrics
4. Calls `enrichChannelWithOpenAi`
5. Writes all results (including `rawOpenaiPayload`) in one big transaction

Change it to the following phases:

**Phase 1 — Claim (unchanged)**

**Phase 2 — Load execution state**  
Expand the select to include:
```typescript
rawOpenaiPayload: true,
rawOpenaiPayloadFetchedAt: true,
youtubeFetchedAt: true,
```

**Phase 3 — YouTube API key (unchanged)**

**Phase 4 — YouTube context, retry-aware**

```typescript
let youtubeContext: YoutubeChannelContext;

if (executionState.youtubeFetchedAt !== null) {
  // YouTube already fetched this attempt — reload directly from DB
  const contextRow = await prisma.channelYoutubeContext.findUnique({
    where: { channelId: input.channelId },
    select: { context: true, fetchedAt: true, lastError: true },
  });
  if (!contextRow?.context) {
    throw new ServiceError(
      "YOUTUBE_CONTEXT_MISSING",
      500,
      "YouTube context missing after youtubeFetchedAt set",
    );
  }
  youtubeContext = contextRow.context as YoutubeChannelContext;
} else {
  // Existing refreshYoutubeContext call (keep as-is)
  youtubeContext = await refreshYoutubeContext({ ... });

  // Intermediate write: mark YouTube as fetched for this attempt
  await prisma.channelEnrichment.update({
    where: { channelId: input.channelId },
    data: { youtubeFetchedAt: new Date() },
  });
}
```

**Phase 5 — OpenAI, retry-aware**

Add a private helper above `executeChannelLlmEnrichment`:

```typescript
function extractProfileFromRawPayload(
  raw: Prisma.JsonValue,
): { summary: string; topics: string[]; brandFitNotes: string; confidence: number } {
  // Parse through the existing outputSchema zod shape.
  // Throw ServiceError("OPENAI_INVALID_STORED_PAYLOAD", 500) if parsing fails.
}
```

Replace the existing `enrichChannelWithOpenAi` call block:

```typescript
let enrichmentResult: { profile: ReturnType<typeof extractProfileFromRawPayload>; rawPayload: unknown };

if (executionState.rawOpenaiPayloadFetchedAt !== null) {
  // OpenAI already called this attempt — re-derive from stored payload
  enrichmentResult = {
    profile: extractProfileFromRawPayload(executionState.rawOpenaiPayload),
    rawPayload: executionState.rawOpenaiPayload,
  };
} else {
  const youtubeMetrics = deriveYoutubeMetrics(youtubeContext);
  const result = await enrichChannelWithOpenAi({ ... });  // existing call

  // Intermediate write: persist raw payload before the final transaction
  await prisma.channelEnrichment.update({
    where: { channelId: input.channelId },
    data: {
      rawOpenaiPayload: toJsonValue(result.rawPayload),
      rawOpenaiPayloadFetchedAt: new Date(),
    },
  });

  enrichmentResult = result;
}
```

Note: `deriveYoutubeMetrics` must be called only in the else branch (fresh call path). In the
reuse path the metrics are not needed because the profile is read from stored payload directly.
The YouTube metrics still needed for the final channel/metric writes — derive them from
`youtubeContext` in both paths before the final transaction.

**Phase 6 — Final transaction**  
Keep the existing four-table transaction (`channelYoutubeContext`, `channel`, `channelMetric`,
`channelEnrichment`) with these changes to the `channelEnrichment` update:
- Remove `rawOpenaiPayload` from this update (already written in Phase 5)
- Add to the completion data: `youtubeFetchedAt: null, rawOpenaiPayloadFetchedAt: null`
  (reset attempt markers so future re-runs start clean)

### 2C. Tests

File: `backend/packages/core/src/week5.integration.test.ts`

Add four test cases to the advanced report request suite:

1. **Skips HypeAuditor when `providerPayloadId` already set**  
   Seed: request with `status: QUEUED`, `providerPayloadId` pointing to an existing
   `channel_provider_payloads` row.  
   Assert: `fetchHypeAuditorChannelInsights` mock NOT called, request ends COMPLETED.

2. **Sets `nextProviderAttemptAt` on `REPORT_NOT_READY`**  
   Seed: request with `status: QUEUED`, no `providerPayloadId`.  
   Mock: `fetchHypeAuditorChannelInsights` throws `HYPEAUDITOR_REPORT_NOT_READY`.  
   Assert: `nextProviderAttemptAt` is approximately `now + 5min`, `status = FAILED`.

3. **Respects cooldown when `nextProviderAttemptAt` is in the future**  
   Seed: request with `status: QUEUED`, `nextProviderAttemptAt: new Date(Date.now() + 60_000)`.  
   Assert: `fetchHypeAuditorChannelInsights` mock NOT called, throws `HYPEAUDITOR_COOLDOWN_ACTIVE`.

4. **Sets `lastProviderAttemptAt` on successful attempt**  
   Seed: request with `status: QUEUED`, no `lastProviderAttemptAt`.  
   Mock: successful HypeAuditor response.  
   Assert: `lastProviderAttemptAt` is non-null.

File: `backend/packages/core/src/week4.integration.test.ts`

Add four test cases to the channel enrichment suite:

1. **Skips OpenAI when `rawOpenaiPayloadFetchedAt` is set**  
   Seed: enrichment with `status: FAILED`, valid `rawOpenaiPayload`, `rawOpenaiPayloadFetchedAt: new Date()`.
   Also seed a fresh `channelYoutubeContext`.  
   Assert: `enrichChannelWithOpenAi` mock NOT called, enrichment ends COMPLETED with fields.

2. **Skips YouTube fetch when `youtubeFetchedAt` is set**  
   Seed: enrichment with `status: FAILED`, `youtubeFetchedAt: new Date()`.
   Seed a valid `channelYoutubeContext`.  
   Assert: `fetchYoutubeChannelContext` mock NOT called.

3. **Resets attempt markers to null on successful completion**  
   Run full execution through completion.  
   Assert: final enrichment row has `youtubeFetchedAt = null` and `rawOpenaiPayloadFetchedAt = null`.

4. **`rawOpenaiPayloadFetchedAt` is set even when final transaction fails**  
   Mock: final transaction throws after OpenAI succeeds.  
   Assert: `rawOpenaiPayloadFetchedAt` is non-null in DB, `status = FAILED`.

### Session 2 verification

```bash
cd backend && npx tsc --noEmit
cd backend/packages/core && npx vitest run week4 week5
```

---

## Session 3 — Discovery Cache + Telemetry

Status: Completed on 2026-04-01

**Scope:** DB-backed discovery cache in `runs/repository.ts` and structured spend logs across all
three execution files. Requires Sessions 1 and 2 to be merged first.

### 3A. YouTube discovery cache

File: `backend/packages/core/src/runs/repository.ts`

Add at the top of the file (after existing imports):

```typescript
import { createHash } from "node:crypto";

// Already exists in other core files — add local copy here
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const YOUTUBE_DISCOVERY_CACHE_TTL_MINUTES = Number(
  process.env.YOUTUBE_DISCOVERY_CACHE_TTL_MINUTES?.trim() || "30",
);

function buildDiscoveryCacheKey(
  query: string,
  userId: string,
  maxResults: number,
): string {
  const normalized = query.trim().toLowerCase().replaceAll(/\s+/g, " ");
  return createHash("sha256")
    .update(JSON.stringify({ query: normalized, userId, maxResults }))
    .digest("hex");
}
```

In `executeRunDiscover`, replace the existing `discoverYoutubeChannels` call block with:

```typescript
const MAX_RESULTS = 50;
const now = new Date();
const cacheKey = buildDiscoveryCacheKey(
  runRequest.query,
  input.requestedByUserId,
  MAX_RESULTS,
);

const cacheHit = await prisma.youtubeDiscoveryCache.findUnique({
  where: { cacheKey },
  select: { payload: true, expiresAt: true },
});

let discovered: YoutubeDiscoveredChannel[];

if (cacheHit && cacheHit.expiresAt > now) {
  discovered = cacheHit.payload as YoutubeDiscoveredChannel[];
} else {
  // Existing discoverYoutubeChannels call (keep existing error-wrapping try/catch)
  const rawDiscovered = await discoverYoutubeChannels({
    apiKey: youtubeKey,
    query: runRequest.query,
    maxResults: MAX_RESULTS,
  });

  discovered = rawDiscovered;

  const expiresAt = new Date(
    Date.now() + YOUTUBE_DISCOVERY_CACHE_TTL_MINUTES * 60 * 1000,
  );

  await prisma.youtubeDiscoveryCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      userId: input.requestedByUserId,
      query: runRequest.query,
      maxResults: MAX_RESULTS,
      payload: toJsonValue(rawDiscovered),
      fetchedAt: now,
      expiresAt,
    },
    update: {
      payload: toJsonValue(rawDiscovered),
      fetchedAt: now,
      expiresAt,
    },
  });
}
```

Everything after this block (channel upsert loop, ranked results, final transaction) is unchanged.

### 3B. Provider spend telemetry

Create new file: `backend/packages/core/src/telemetry.ts`

```typescript
type ProviderSpendEvent = {
  provider: "hypeauditor" | "openai" | "youtube_discovery" | "youtube_context";
  operation: string;
  outcome: "fresh_call" | "cache_hit" | "payload_reuse" | "not_ready" | "error";
  retryAttempt: boolean;
  durationMs: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
};

export function logProviderSpend(event: ProviderSpendEvent): void {
  console.log(JSON.stringify({ type: "provider_spend", ...event }));
}
```

Add private helper to `backend/packages/core/src/enrichment/index.ts`:

```typescript
function extractTokenUsage(
  rawPayload: unknown,
): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
  if (!rawPayload || typeof rawPayload !== "object") return undefined;
  const usage = (rawPayload as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const prompt = Number(u.prompt_tokens);
  const completion = Number(u.completion_tokens);
  const total = Number(u.total_tokens);
  if (!Number.isFinite(prompt)) return undefined;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}
```

**Instrumentation points:**

`backend/packages/core/src/approvals/index.ts` — import `logProviderSpend` from `../telemetry`:
- After Phase 3 payload-reuse skip: log `{ provider: "hypeauditor", operation: "fetch_insights", outcome: "payload_reuse", retryAttempt: true, durationMs: 0 }`
- After Phase 3 cooldown rejection: log `{ provider: "hypeauditor", operation: "fetch_insights", outcome: "not_ready", retryAttempt: true, durationMs: 0 }`
- After successful HypeAuditor call: log `{ provider: "hypeauditor", operation: "fetch_insights", outcome: "fresh_call", retryAttempt: executionState.lastProviderAttemptAt !== null, durationMs }`
- On `REPORT_NOT_READY` before rethrowing: log `{ provider: "hypeauditor", operation: "fetch_insights", outcome: "not_ready", retryAttempt: ..., durationMs }`

`backend/packages/core/src/enrichment/index.ts` — import `logProviderSpend` from `../telemetry`:
- YouTube context, reuse path: log `{ provider: "youtube_context", operation: "refresh_context", outcome: "payload_reuse", retryAttempt: true, durationMs: 0 }`
- YouTube context, fresh call: log `{ provider: "youtube_context", operation: "refresh_context", outcome: "fresh_call", retryAttempt: executionState.youtubeFetchedAt !== null, durationMs }`
- OpenAI, reuse path: log `{ provider: "openai", operation: "enrich_channel", outcome: "payload_reuse", retryAttempt: true, durationMs: 0 }`
- OpenAI, fresh call: log `{ provider: "openai", operation: "enrich_channel", outcome: "fresh_call", retryAttempt: executionState.rawOpenaiPayloadFetchedAt !== null, durationMs, tokenUsage: extractTokenUsage(result.rawPayload) }`

`backend/packages/core/src/runs/repository.ts` — import `logProviderSpend` from `../telemetry`:
- Cache hit path: log `{ provider: "youtube_discovery", operation: "discover_channels", outcome: "cache_hit", retryAttempt: false, durationMs: 0 }`
- Fresh call path: log `{ provider: "youtube_discovery", operation: "discover_channels", outcome: "fresh_call", retryAttempt: false, durationMs }`

For all `durationMs` values, wrap the relevant provider call with `Date.now()` before/after.

### 3C. Tests

File: `backend/packages/core/src/week3.integration.test.ts`

Add three test cases to the run discovery suite:

1. **Returns cached results on second run with same query and user**  
   Create two run requests with the same query and user. Execute both.  
   Assert: `discoverYoutubeChannels` mock called exactly once.

2. **Calls YouTube again after cache expiry**  
   Seed a `youtubeDiscoveryCache` row with `expiresAt` set to a past timestamp.  
   Execute a run request.  
   Assert: `discoverYoutubeChannels` mock called.

3. **Writes a cache entry after a fresh call**  
   Execute a run request.  
   Assert: `prisma.youtubeDiscoveryCache.findUnique({ where: { cacheKey: ... } })` returns a
   non-null row with the correct `query`, `userId`, and `maxResults` values.

### Session 3 verification

```bash
cd backend && npx tsc --noEmit
cd backend/packages/core && npx vitest run week3 week4 week5
```
