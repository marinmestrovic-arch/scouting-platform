# Codex Implementation Guide: Campaign-Aware Creator Assessment

- Status: Not Started
- Date: 2026-04-15
- Owner: Ivan

---

## Context

The existing OpenAI enrichment (`gpt-5-nano`) produces a static channel profile — summary, topics, brandFitNotes, confidence — stored on `ChannelEnrichment`. That profile answers "what is this creator?" and does not change per campaign.

The high-value question campaign managers need answered is different: **"Is this specific creator right for this specific campaign?"** That answer is dynamic — the same creator fits a GPU brand but not a children's toy campaign — and is exactly the kind of contextual reasoning an LLM is good at. Today that judgment happens manually in a campaign manager's head for every creator, every campaign.

This plan adds a **second enrichment layer** scoped per-run × per-channel: a `RunChannelAssessment` that scores fit for a specific campaign brief and explains why.

**Model:** `gpt-4.1-mini`, **hardcoded**. Mini reasons noticeably better than nano on judgment tasks without the cost of full-size models. No env override, no runtime flag — the model is a string literal in the new integration file and tests lock that in.

**Outcome:** After discovery completes and a campaign brief is populated on the run, a campaign manager POSTs `/api/runs/:id/assess` and receives a fit-scored, reasoned shortlist through the run-detail API. The platform evolves from list-generator to shortlister.

---

## Architectural Guardrails

1. **ADR-002 precedence unchanged.** `RunChannelAssessment` is a per-run snapshot. It never writes back into `channels.*`, `channel_enrichments.*`, or resolved catalog state. Adding a small append-only section to ADR-002 clarifying "run-scoped artifacts" is part of Session 7.
2. **Backend-only.** No React, no `frontend/web/lib/*-api.ts` clients, no components. Frontend is a follow-up plan.
3. **Hardcoded model.** `gpt-4.1-mini` is a string literal inside the new integration file. No env lookup, no constructor option, no per-call override. Tests assert the literal even with `OPENAI_MODEL=gpt-5` in the environment.
4. **Existing enrichment is read-only.** Do not edit `channel-enrichment.ts` or `executeChannelLlmEnrichment`. Copy helper shapes (`getApiKey`, `getClient`, `OpenAiClientLike`, `slimYoutubeContext`, error class) into the new file — duplication is correct because the two flows diverge in schema, prompt, and model.
5. **Queue is the only execution path.** HTTP endpoints enqueue and return 202. All LLM work runs in the worker.
6. **Retries from pg-boss.** Inherit the existing `retryLimit: 5, retryDelay: 30, retryBackoff: true`. No custom retry logic.
7. **Migration is additive.** Nullable columns on `run_requests`, a new `run_channel_assessments` table, a new enum. Zero destructive changes.
8. **Manual trigger only.** Assessment runs exclusively via `POST /api/runs/:id/assess`. No auto-enqueue on run completion, no auto-enqueue on channel add.
9. **Run must be COMPLETED.** Non-completed runs throw `RUN_NOT_COMPLETED` (409).
10. **HubSpot out of scope.** No fit-score push, no HubSpot property mapping.

---

## Delivery Shape

Seven sessions, executed in order. Each session is self-contained and testable.

| Session | Scope | Risk |
|---------|-------|------|
| 1 | Prisma schema + migration | Low |
| 2 | Shared contracts (jobs, assessment types, brief fields) | Low |
| 3 | OpenAI integration with hardcoded `gpt-4.1-mini` | Medium |
| 4 | Core service (request, execute, update brief) | Medium-high |
| 5 | Worker registration | Low |
| 6 | HTTP API (POST assess, PATCH brief, GET extension) | Low-medium |
| 7 | E2E integration test + ADR note + observability | Low |

Sessions 4 and 5 can be parallelized after Session 3 passes; otherwise strict sequential.

---

## Session 1 — Prisma Schema + Migration

**Scope:** Add structured brief fields to `RunRequest` and a new per-run-per-channel assessment table. Additive only.

### 1A. Add enum to `schema.prisma`

File: `backend/packages/db/prisma/schema.prisma`

Add after the existing `ChannelEnrichmentStatus` enum (search for `enum ChannelEnrichmentStatus`):

```prisma
enum RunChannelAssessmentStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED

  @@map("run_channel_assessment_status")
}
```

### 1B. Extend `RunRequest`

In `model RunRequest`, add the following fields (place them after the existing HubSpot metadata fields, before `results RunResult[]`):

```prisma
clientIndustry       String?  @map("client_industry")
campaignObjective    String?  @map("campaign_objective") @db.Text
targetAudienceAge    String?  @map("target_audience_age")
targetAudienceGender String?  @map("target_audience_gender")
targetGeographies    Json?    @map("target_geographies")
contentRestrictions  Json?    @map("content_restrictions")
budgetTier           String?  @map("budget_tier")
deliverables         Json?    @map("deliverables")

channelAssessments   RunChannelAssessment[]
```

### 1C. Add the new model

Add after `model RunResult`:

```prisma
model RunChannelAssessment {
  id                         String                     @id @default(uuid()) @db.Uuid
  runRequestId               String                     @map("run_request_id") @db.Uuid
  channelId                  String                     @map("channel_id") @db.Uuid
  status                     RunChannelAssessmentStatus @default(QUEUED)
  model                      String?
  fitScore                   Float?                     @map("fit_score")
  fitReasons                 Json?                      @map("fit_reasons")
  fitConcerns                Json?                      @map("fit_concerns")
  recommendedAngles          Json?                      @map("recommended_angles")
  avoidTopics                Json?                      @map("avoid_topics")
  rawOpenaiPayload           Json?                      @map("raw_openai_payload")
  rawOpenaiPayloadFetchedAt  DateTime?                  @map("raw_openai_payload_fetched_at")
  assessedAt                 DateTime?                  @map("assessed_at")
  startedAt                  DateTime?                  @map("started_at")
  lastError                  String?                    @map("last_error") @db.Text
  createdAt                  DateTime                   @default(now()) @map("created_at")
  updatedAt                  DateTime                   @updatedAt @map("updated_at")

  runRequest RunRequest @relation(fields: [runRequestId], references: [id], onDelete: Cascade)
  channel    Channel    @relation(fields: [channelId], references: [id], onDelete: Restrict)

  @@unique([runRequestId, channelId], map: "run_channel_assessments_run_request_id_channel_id_key")
  @@index([runRequestId], map: "run_channel_assessments_run_request_id_idx")
  @@index([status], map: "run_channel_assessments_status_idx")
  @@index([channelId], map: "run_channel_assessments_channel_id_idx")
  @@map("run_channel_assessments")
}
```

### 1D. Add back-relation to `Channel`

In `model Channel`, append to the relation list:

```prisma
channelAssessments RunChannelAssessment[]
```

### 1E. Migration SQL

Create `backend/packages/db/prisma/migrations/20260415120000_run_channel_assessments_and_brief_fields/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "run_channel_assessment_status" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable: run_requests (add brief fields)
ALTER TABLE "run_requests"
  ADD COLUMN "client_industry"        TEXT,
  ADD COLUMN "campaign_objective"     TEXT,
  ADD COLUMN "target_audience_age"    TEXT,
  ADD COLUMN "target_audience_gender" TEXT,
  ADD COLUMN "target_geographies"     JSONB,
  ADD COLUMN "content_restrictions"   JSONB,
  ADD COLUMN "budget_tier"            TEXT,
  ADD COLUMN "deliverables"           JSONB;

-- CreateTable
CREATE TABLE "run_channel_assessments" (
  "id"                             UUID NOT NULL,
  "run_request_id"                 UUID NOT NULL,
  "channel_id"                     UUID NOT NULL,
  "status"                         "run_channel_assessment_status" NOT NULL DEFAULT 'QUEUED',
  "model"                          TEXT,
  "fit_score"                      DOUBLE PRECISION,
  "fit_reasons"                    JSONB,
  "fit_concerns"                   JSONB,
  "recommended_angles"             JSONB,
  "avoid_topics"                   JSONB,
  "raw_openai_payload"             JSONB,
  "raw_openai_payload_fetched_at"  TIMESTAMP(3),
  "assessed_at"                    TIMESTAMP(3),
  "started_at"                     TIMESTAMP(3),
  "last_error"                     TEXT,
  "created_at"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "run_channel_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "run_channel_assessments_run_request_id_channel_id_key"
  ON "run_channel_assessments"("run_request_id", "channel_id");

CREATE INDEX "run_channel_assessments_run_request_id_idx"
  ON "run_channel_assessments"("run_request_id");

CREATE INDEX "run_channel_assessments_status_idx"
  ON "run_channel_assessments"("status");

CREATE INDEX "run_channel_assessments_channel_id_idx"
  ON "run_channel_assessments"("channel_id");

-- AddForeignKey
ALTER TABLE "run_channel_assessments"
  ADD CONSTRAINT "run_channel_assessments_run_request_id_fkey"
  FOREIGN KEY ("run_request_id") REFERENCES "run_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "run_channel_assessments"
  ADD CONSTRAINT "run_channel_assessments_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "channels"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

### 1F. Migration test

File: `backend/packages/db/src/migrations.test.ts`

Add assertions for the new migration directory:

- Migration SQL contains `CREATE TYPE "run_channel_assessment_status"`.
- Migration SQL contains `ADD COLUMN "client_industry"`.
- Migration SQL contains `CREATE TABLE "run_channel_assessments"`.
- Migration SQL contains `CREATE UNIQUE INDEX "run_channel_assessments_run_request_id_channel_id_key"`.
- Migration SQL contains both foreign keys.

### Session 1 verification

```bash
pnpm db:validate
pnpm db:generate
pnpm db:migrate:test
pnpm --filter @scouting-platform/db typecheck
pnpm --filter @scouting-platform/db exec vitest run src/migrations.test.ts
```

---

## Session 2 — Shared Contracts

**Scope:** Add brief fields to run contracts, new assessment contracts module, new job name and payload.

### 2A. Extend `runMetadataResponseSchema`

File: `shared/packages/contracts/src/runs.ts`

Find `runMetadataResponseSchema` and add the new fields (all `.nullable().optional()`):

```typescript
clientIndustry: z.string().trim().min(1).max(200).nullable().optional(),
campaignObjective: z.string().trim().min(1).max(2000).nullable().optional(),
targetAudienceAge: z.string().trim().min(1).max(50).nullable().optional(),
targetAudienceGender: z.string().trim().min(1).max(50).nullable().optional(),
targetGeographies: z.array(z.string().trim().min(1)).nullable().optional(),
contentRestrictions: z.array(z.string().trim().min(1)).nullable().optional(),
budgetTier: z.string().trim().min(1).max(50).nullable().optional(),
deliverables: z.array(z.string().trim().min(1)).nullable().optional(),
```

### 2B. Extend `runMetadataInputSchema` / `createRunRequestSchema`

Same file. Find `runMetadataInputSchema` (the inputs accepted on run create) and add the same 8 brief fields as above. Rationale: the user decision was to allow briefs on both create and via PATCH — this enables the create path.

### 2C. Add `updateRunBriefRequestSchema`

Same file, new export:

```typescript
export const updateRunBriefRequestSchema = z.object({
  clientIndustry: z.string().trim().min(1).max(200).nullable().optional(),
  campaignObjective: z.string().trim().min(1).max(2000).nullable().optional(),
  targetAudienceAge: z.string().trim().min(1).max(50).nullable().optional(),
  targetAudienceGender: z.string().trim().min(1).max(50).nullable().optional(),
  targetGeographies: z.array(z.string().trim().min(1)).max(50).nullable().optional(),
  contentRestrictions: z.array(z.string().trim().min(1)).max(50).nullable().optional(),
  budgetTier: z.string().trim().min(1).max(50).nullable().optional(),
  deliverables: z.array(z.string().trim().min(1)).max(50).nullable().optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: "At least one brief field must be provided" },
);

export type UpdateRunBriefRequest = z.infer<typeof updateRunBriefRequestSchema>;
```

### 2D. Add the new job name + payload

File: `shared/packages/contracts/src/jobs.ts`

1. Append `"runs.assess.channel-fit"` to the `JOB_NAMES` tuple.
2. Add schema next to the other payload schemas:

```typescript
export const runsAssessChannelFitPayloadSchema = z.object({
  runRequestId: uuid,
  channelId: uuid,
  requestedByUserId: uuid,
});
```

3. Add it to the `jobPayloadSchemas` map:

```typescript
"runs.assess.channel-fit": runsAssessChannelFitPayloadSchema,
```

### 2E. New contracts module: `runs-assessment.ts`

File: `shared/packages/contracts/src/runs-assessment.ts` (new)

```typescript
import { z } from "zod";

const uuid = z.string().uuid();
const isoDatetime = z.string().datetime();

export const runChannelAssessmentStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
]);

export type RunChannelAssessmentStatus = z.infer<typeof runChannelAssessmentStatusSchema>;

export const runChannelAssessmentItemSchema = z.object({
  id: uuid,
  runRequestId: uuid,
  channelId: uuid,
  status: runChannelAssessmentStatusSchema,
  model: z.string().nullable(),
  fitScore: z.number().min(0).max(1).nullable(),
  fitReasons: z.array(z.string()).nullable(),
  fitConcerns: z.array(z.string()).nullable(),
  recommendedAngles: z.array(z.string()).nullable(),
  avoidTopics: z.array(z.string()).nullable(),
  assessedAt: isoDatetime.nullable(),
  lastError: z.string().nullable(),
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
});

export type RunChannelAssessmentItem = z.infer<typeof runChannelAssessmentItemSchema>;

export const triggerRunAssessmentResponseSchema = z.object({
  runId: uuid,
  enqueued: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  assessments: z.array(runChannelAssessmentItemSchema),
});

export type TriggerRunAssessmentResponse = z.infer<typeof triggerRunAssessmentResponseSchema>;
```

### 2F. Export from contracts index

File: `shared/packages/contracts/src/index.ts`

Add:

```typescript
export * from "./runs-assessment";
export { updateRunBriefRequestSchema, type UpdateRunBriefRequest } from "./runs";
```

### 2G. Tests

File: `shared/packages/contracts/src/runs-assessment.test.ts` (new)

1. `runChannelAssessmentItemSchema.parse(validPayload)` returns the shape.
2. `fitScore: 1.5` fails validation.
3. `fitScore: -0.1` fails validation.
4. Invalid status string fails.
5. `triggerRunAssessmentResponseSchema` with `enqueued: -1` fails.

Add to existing job test file (or new):

1. `runsAssessChannelFitPayloadSchema.parse({ runRequestId, channelId, requestedByUserId })` returns the shape.
2. `parseJobPayload("runs.assess.channel-fit", {...})` returns parsed payload.
3. Missing `runRequestId` fails.

Add to `runs.test.ts` (if exists, else create):

1. `updateRunBriefRequestSchema.parse({})` fails (refinement rejects empty).
2. `updateRunBriefRequestSchema.parse({ clientIndustry: "tech" })` succeeds.
3. `createRunRequestSchema` accepts brief fields when provided.

### Session 2 verification

```bash
pnpm --filter @scouting-platform/contracts exec vitest run
pnpm --filter @scouting-platform/contracts typecheck
```

---

## Session 3 — OpenAI Integration (Hardcoded `gpt-4.1-mini`)

**Scope:** New OpenAI integration that scores a creator's fit for a campaign brief. Mirror the shape of `channel-enrichment.ts` but copy helpers locally. Model is hardcoded.

### 3A. Create the integration file

File: `backend/packages/integrations/src/openai/campaign-fit-assessment.ts` (new)

```typescript
import { z } from "zod";
import OpenAI from "openai";
import type { YoutubeChannelContext } from "../youtube/context";

const OPENAI_MODEL = "gpt-4.1-mini" as const;

// ============ Schemas ============

const outputSchema = z.object({
  fitScore: z.number().min(0).max(1),
  fitReasons: z.array(z.string().trim().min(1)).min(1).max(10),
  fitConcerns: z.array(z.string().trim().min(1)).max(10),
  recommendedAngles: z.array(z.string().trim().min(1)).max(10),
  avoidTopics: z.array(z.string().trim().min(1)).max(10),
});

export type OpenAiCampaignFitAssessment = z.infer<typeof outputSchema>;

const campaignBriefSchema = z.object({
  client: z.string().nullable(),
  campaignName: z.string().nullable(),
  clientIndustry: z.string().nullable(),
  campaignObjective: z.string().nullable(),
  targetAudienceAge: z.string().nullable(),
  targetAudienceGender: z.string().nullable(),
  targetGeographies: z.array(z.string()).nullable(),
  contentRestrictions: z.array(z.string()).nullable(),
  budgetTier: z.string().nullable(),
  deliverables: z.array(z.string()).nullable(),
});

const inputSchema = z.object({
  channel: z.object({
    youtubeChannelId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    handle: z.string().trim().nullable(),
    description: z.string().trim().nullable(),
  }),
  youtubeContext: z.custom<YoutubeChannelContext>(),
  enrichmentProfile: z.object({
    summary: z.string(),
    topics: z.array(z.string()),
    brandFitNotes: z.string(),
  }).nullable(),
  campaignBrief: campaignBriefSchema,
  apiKey: z.string().trim().min(1).optional(),
  client: z.custom<OpenAiClientLike>().optional(),
});

export type EnrichCampaignFitInput = z.input<typeof inputSchema>;

// ============ Client abstraction ============

export interface OpenAiClientLike {
  chat: {
    completions: {
      create: (params: {
        model: string;
        messages: Array<{ role: string; content: string }>;
        response_format: { type: "json_object" };
      }) => Promise<{
        choices: Array<{ message: { content: string | null } }>;
        usage?: unknown;
      }>;
    };
  };
}

// ============ Errors ============

export type OpenAiCampaignFitErrorCode =
  | "OPENAI_API_KEY_MISSING"
  | "OPENAI_AUTH_FAILED"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_INVALID_RESPONSE"
  | "OPENAI_CAMPAIGN_FIT_FAILED";

export class OpenAiCampaignFitError extends Error {
  readonly code: OpenAiCampaignFitErrorCode;
  readonly status: number;

  constructor(code: OpenAiCampaignFitErrorCode, message: string, status: number) {
    super(message);
    this.name = "OpenAiCampaignFitError";
    this.code = code;
    this.status = status;
  }
}

export function isOpenAiCampaignFitError(err: unknown): err is OpenAiCampaignFitError {
  return err instanceof OpenAiCampaignFitError;
}

// ============ Helpers (copied locally — do not share with channel-enrichment) ============

function getApiKey(inputKey: string | undefined): string {
  const fromInput = inputKey?.trim();
  if (fromInput) return fromInput;
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  throw new OpenAiCampaignFitError(
    "OPENAI_API_KEY_MISSING",
    "OpenAI API key not configured",
    500,
  );
}

function getClient(apiKey: string, override?: OpenAiClientLike): OpenAiClientLike {
  if (override) return override;
  return new OpenAI({ apiKey }) as unknown as OpenAiClientLike;
}

function slimYoutubeContext(ctx: YoutubeChannelContext): unknown {
  const recentVideos = (ctx.recentVideos ?? []).slice(0, 5).map((v) => ({
    videoId: v.videoId,
    title: v.title,
    description: v.description?.slice(0, 200) ?? null,
    publishedAt: v.publishedAt,
    viewCount: v.viewCount,
    likeCount: v.likeCount,
    commentCount: v.commentCount,
  }));
  return {
    youtubeChannelId: ctx.youtubeChannelId,
    title: ctx.title,
    customUrl: ctx.customUrl,
    country: ctx.country,
    defaultLanguage: ctx.defaultLanguage,
    publishedAt: ctx.publishedAt,
    subscriberCount: ctx.subscriberCount,
    viewCount: ctx.viewCount,
    videoCount: ctx.videoCount,
    recentVideos,
  };
}

function buildPrompt(input: z.output<typeof inputSchema>): string {
  return JSON.stringify({
    campaignBrief: input.campaignBrief,
    channel: input.channel,
    youtubeContext: slimYoutubeContext(input.youtubeContext),
    enrichmentProfile: input.enrichmentProfile,
    instructions: {
      fitScore:
        "Return a number from 0 to 1 scoring how well this creator fits THIS specific campaign brief. 0 = clearly wrong fit, 1 = perfect fit. Weight: audience match, content style alignment, brand safety for this client's industry, presence of campaign-required themes.",
      fitReasons:
        "List 1-10 concrete reasons this creator fits the brief. Each reason must cite a specific signal (audience demo, content topic, prior sponsorship pattern, style) AND tie it to a brief requirement. Avoid generic platitudes.",
      fitConcerns:
        "List 0-10 concrete concerns or misfit signals. Include audience mismatches, content-restriction violations, brand-safety risks for this client's industry, presence of competitor mentions. Empty array if no concerns.",
      recommendedAngles:
        "List 0-10 creative angles that would work for this creator for this campaign. Be specific — reference this creator's recurring content formats when possible.",
      avoidTopics:
        "List 0-10 content types or topics this creator should avoid for this campaign to preserve brief alignment and brand safety.",
    },
  });
}

function toProviderError(err: unknown): OpenAiCampaignFitError {
  const status = (err as { status?: number })?.status;
  const message = (err as { message?: string })?.message ?? "OpenAI request failed";
  if (status === 401 || status === 403) {
    return new OpenAiCampaignFitError("OPENAI_AUTH_FAILED", message, status);
  }
  if (status === 429) {
    return new OpenAiCampaignFitError("OPENAI_RATE_LIMITED", message, 429);
  }
  return new OpenAiCampaignFitError("OPENAI_CAMPAIGN_FIT_FAILED", message, status ?? 500);
}

// ============ Raw payload extractor ============

export function extractOpenAiCampaignFitFromRawPayload(
  rawPayload: unknown,
): OpenAiCampaignFitAssessment {
  const content =
    (rawPayload as { choices?: Array<{ message?: { content?: string | null } }> })?.choices?.[0]
      ?.message?.content ?? null;
  if (!content) {
    throw new OpenAiCampaignFitError(
      "OPENAI_INVALID_RESPONSE",
      "OpenAI response missing content",
      502,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new OpenAiCampaignFitError(
      "OPENAI_INVALID_RESPONSE",
      "OpenAI response was not valid JSON",
      502,
    );
  }
  const result = outputSchema.safeParse(parsed);
  if (!result.success) {
    throw new OpenAiCampaignFitError(
      "OPENAI_INVALID_RESPONSE",
      `OpenAI response failed schema validation: ${result.error.message}`,
      502,
    );
  }
  return result.data;
}

// ============ Main exported function ============

export type EnrichCampaignFitResult = {
  profile: OpenAiCampaignFitAssessment;
  rawPayload: unknown;
  model: typeof OPENAI_MODEL;
};

export async function enrichCampaignFitWithOpenAi(
  rawInput: EnrichCampaignFitInput,
): Promise<EnrichCampaignFitResult> {
  const input = inputSchema.parse(rawInput);
  const apiKey = getApiKey(input.apiKey);
  const client = getClient(apiKey, input.client);
  const prompt = buildPrompt(input);

  let rawPayload: unknown;
  try {
    rawPayload = await client.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You assess a YouTube creator's fit for a specific marketing campaign brief and must return valid JSON with fitScore, fitReasons, fitConcerns, recommendedAngles, and avoidTopics.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    });
  } catch (err) {
    throw toProviderError(err);
  }

  const profile = extractOpenAiCampaignFitFromRawPayload(rawPayload);
  return { profile, rawPayload, model: OPENAI_MODEL };
}
```

### 3B. Export from integrations index

File: `backend/packages/integrations/src/index.ts`

Add:

```typescript
export * from "./openai/campaign-fit-assessment";
```

### 3C. Tests

File: `backend/packages/integrations/src/openai/campaign-fit-assessment.test.ts` (new)

Required cases:

1. **Hardcoded model — ignores `OPENAI_MODEL` env var** (CRITICAL).
   Set `process.env.OPENAI_MODEL = "gpt-5"`, call function with mocked client. Assert `client.chat.completions.create` was called with `model: "gpt-4.1-mini"`. Clean up env var in `finally`.

2. **Hardcoded model — ignores any inherited config**.
   Regardless of how the function is called, `create` is invoked with `model: "gpt-4.1-mini"`.

3. **Omits temperature**.
   Assert the request body has no `temperature` key.

4. **Uses `response_format: { type: "json_object" }`**.
   Assert exactly this shape is passed.

5. **Parses valid assessment output**.
   Mock response with valid JSON → returns `{ profile, rawPayload, model: "gpt-4.1-mini" }`.

6. **Rejects fitScore > 1**.
   Mock response with `fitScore: 1.5` → throws `OPENAI_INVALID_RESPONSE`.

7. **Rejects fitScore < 0**.
   Mock response with `fitScore: -0.1` → throws `OPENAI_INVALID_RESPONSE`.

8. **Rejects empty fitReasons**.
   Mock response with `fitReasons: []` → throws `OPENAI_INVALID_RESPONSE`.

9. **Maps 401 to `OPENAI_AUTH_FAILED`**.
   Mock client throws `{ status: 401, message: "bad auth" }` → throws `OpenAiCampaignFitError` with code `OPENAI_AUTH_FAILED`, status 401.

10. **Maps 429 to `OPENAI_RATE_LIMITED`**.
    Mock client throws `{ status: 429 }` → throws with code `OPENAI_RATE_LIMITED`.

11. **Missing API key throws `OPENAI_API_KEY_MISSING`**.
    Delete `process.env.OPENAI_API_KEY`, do not pass `apiKey` in input → throws with that code.

12. **Prompt JSON-encodes campaignBrief**.
    Inspect the user message content — parse it and assert `campaignBrief.campaignObjective` is present.

13. **Slims youtube context to 5 videos, descriptions ≤ 200 chars**.
    Provide a context with 10 videos and long descriptions. Parse prompt. Assert `youtubeContext.recentVideos.length === 5` and `recentVideos[0].description.length <= 200`.

### Session 3 verification

```bash
pnpm --filter @scouting-platform/integrations exec vitest run src/openai/campaign-fit-assessment.test.ts
pnpm --filter @scouting-platform/integrations typecheck
pnpm --filter @scouting-platform/integrations lint
```

---

## Session 4 — Core Service

**Scope:** Orchestration for requesting and executing assessments. Mirrors the shape of `executeChannelLlmEnrichment` at `backend/packages/core/src/enrichment/index.ts:307-638`.

### 4A. Create the assessment module

File: `backend/packages/core/src/runs/assessment.ts` (new)

Export four functions:

1. **`requestRunAssessment(input: { runId: string; userId: string; role: "admin" | "user" }): Promise<TriggerRunAssessmentResponse>`**
   - Load `RunRequest` via `prisma.runRequest.findUnique` including `requestedByUserId`, `status`, all 8 brief columns, and `results: { select: { channelId: true } }`.
   - If missing → `throw new ServiceError("RUN_NOT_FOUND", 404, "Run not found")`.
   - If `role !== "admin" && requestedByUserId !== userId` → `throw new ServiceError("RUN_FORBIDDEN", 403, "You do not have access to this run")`.
   - If `status !== PrismaRunRequestStatus.COMPLETED` → `throw new ServiceError("RUN_NOT_COMPLETED", 409, "Run must be completed before assessment")`.
   - If every brief field is null/empty → `throw new ServiceError("RUN_BRIEF_MISSING", 400, "Run has no campaign brief populated")`.
   - In `prisma.$transaction`:
     - For each `result.channelId`, upsert `RunChannelAssessment`:
       - `create`: `{ runRequestId, channelId, status: "QUEUED" }`.
       - `update`: if existing status is `COMPLETED` or `FAILED`, reset `{ status: "QUEUED", startedAt: null, assessedAt: null, lastError: null, rawOpenaiPayloadFetchedAt: null }`. If `QUEUED` or `RUNNING`, no-op (return existing).
   - After transaction, track which rows transitioned to `QUEUED` in this call. For each, `await enqueueRunAssessChannelFitJob(...)`.
   - If enqueue throws for a channel: `prisma.runChannelAssessment.update({ where: { id }, data: { status: "FAILED", lastError: err.message } })`. Continue with other channels. Count as `skipped`.
   - Return shaped per `triggerRunAssessmentResponseSchema` with `enqueued`, `skipped`, and the full `assessments` list.

2. **`executeRunChannelFitAssessment(input: { runRequestId: string; channelId: string; requestedByUserId: string }): Promise<void>`**
   - Structure mirrors `executeChannelLlmEnrichment`. High-level flow:

```typescript
export async function executeRunChannelFitAssessment(input: {
  runRequestId: string;
  channelId: string;
  requestedByUserId: string;
}): Promise<void> {
  const ASSESSMENT_MODEL = "gpt-4.1-mini";

  // 1. Claim the row
  const claim = await prisma.runChannelAssessment.updateMany({
    where: {
      runRequestId: input.runRequestId,
      channelId: input.channelId,
      status: { in: ["QUEUED", "FAILED"] },
    },
    data: { status: "RUNNING", startedAt: new Date(), lastError: null },
  });

  if (claim.count === 0) return; // already running/completed or missing

  try {
    // 2. Load state
    const row = await prisma.runChannelAssessment.findUnique({
      where: {
        runRequestId_channelId: {
          runRequestId: input.runRequestId,
          channelId: input.channelId,
        },
      },
      include: { runRequest: true, channel: true },
    });
    if (!row) return;

    // 3. Load optional youtube context + enrichment profile
    const youtubeContextRow = await prisma.channelYoutubeContext.findUnique({
      where: { channelId: input.channelId },
    });
    const enrichmentRow = await prisma.channelEnrichment.findUnique({
      where: { channelId: input.channelId },
    });

    // 4. Build campaignBrief from the run
    const brief = {
      client: row.runRequest.client,
      campaignName: row.runRequest.campaignName,
      clientIndustry: row.runRequest.clientIndustry,
      campaignObjective: row.runRequest.campaignObjective,
      targetAudienceAge: row.runRequest.targetAudienceAge,
      targetAudienceGender: row.runRequest.targetAudienceGender,
      targetGeographies: parseStringArrayOrNull(row.runRequest.targetGeographies),
      contentRestrictions: parseStringArrayOrNull(row.runRequest.contentRestrictions),
      budgetTier: row.runRequest.budgetTier,
      deliverables: parseStringArrayOrNull(row.runRequest.deliverables),
    };

    // 5. Payload reuse if prior run persisted raw payload
    let result: EnrichCampaignFitResult;
    if (row.rawOpenaiPayloadFetchedAt && row.rawOpenaiPayload) {
      const profile = extractOpenAiCampaignFitFromRawPayload(row.rawOpenaiPayload);
      result = { profile, rawPayload: row.rawOpenaiPayload, model: ASSESSMENT_MODEL };
      logProviderSpend({
        provider: "openai",
        operation: "assess_run_channel_fit",
        outcome: "payload_reuse",
        retryAttempt: true,
        durationMs: 0,
      });
    } else {
      const start = Date.now();
      try {
        result = await enrichCampaignFitWithOpenAi({
          channel: {
            youtubeChannelId: row.channel.youtubeChannelId,
            title: row.channel.title,
            handle: row.channel.handle,
            description: row.channel.description,
          },
          youtubeContext: youtubeContextRow?.context
            ? (youtubeContextRow.context as YoutubeChannelContext)
            : buildMinimalYoutubeContext(row.channel),
          enrichmentProfile: enrichmentRow?.status === "COMPLETED" && enrichmentRow.summary
            ? {
                summary: enrichmentRow.summary,
                topics: parseStringArrayOrNull(enrichmentRow.topics) ?? [],
                brandFitNotes: enrichmentRow.brandFitNotes ?? "",
              }
            : null,
          campaignBrief: brief,
        });

        // Persist raw payload IMMEDIATELY so retries can reuse
        await prisma.runChannelAssessment.update({
          where: { id: row.id },
          data: {
            rawOpenaiPayload: result.rawPayload as Prisma.InputJsonValue,
            rawOpenaiPayloadFetchedAt: new Date(),
          },
        });

        logProviderSpend({
          provider: "openai",
          operation: "assess_run_channel_fit",
          outcome: "fresh_call",
          retryAttempt: false,
          durationMs: Date.now() - start,
          tokenUsage: extractTokenUsage(result.rawPayload),
        });
      } catch (err) {
        if (isOpenAiCampaignFitError(err)) {
          logProviderSpend({
            provider: "openai",
            operation: "assess_run_channel_fit",
            outcome: "error",
            retryAttempt: false,
            durationMs: Date.now() - start,
            errorCode: err.code,
          });
          throw new ServiceError(err.code, err.status, err.message);
        }
        throw err;
      }
    }

    // 6. Durable commit
    await prisma.runChannelAssessment.update({
      where: { id: row.id },
      data: {
        status: "COMPLETED",
        model: ASSESSMENT_MODEL,
        fitScore: result.profile.fitScore,
        fitReasons: result.profile.fitReasons as Prisma.InputJsonValue,
        fitConcerns: result.profile.fitConcerns as Prisma.InputJsonValue,
        recommendedAngles: result.profile.recommendedAngles as Prisma.InputJsonValue,
        avoidTopics: result.profile.avoidTopics as Prisma.InputJsonValue,
        assessedAt: new Date(),
        rawOpenaiPayloadFetchedAt: null,
        lastError: null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.runChannelAssessment.updateMany({
      where: {
        runRequestId: input.runRequestId,
        channelId: input.channelId,
        status: "RUNNING",
      },
      data: { status: "FAILED", lastError: message },
    });
    throw err;
  }
}
```

   Helpers (same file):
   - `parseStringArrayOrNull(value: Prisma.JsonValue | null): string[] | null` — Safely parse JSON column to `string[]`; return `null` on parse failure.
   - `buildMinimalYoutubeContext(channel): YoutubeChannelContext` — synthesize a minimal context from the Channel row for channels without a fetched YouTube context (required fields null, empty `recentVideos`).
   - `extractTokenUsage(rawPayload): TokenUsage | undefined` — same shape as channel enrichment uses.

3. **`enqueueRunAssessChannelFitJob(payload: RunsAssessChannelFitPayload): Promise<void>`**

```typescript
export async function enqueueRunAssessChannelFitJob(
  payload: RunsAssessChannelFitPayload,
): Promise<void> {
  await enqueueJob("runs.assess.channel-fit", payload);
}
```

4. **`getRunAssessments(input: { runId: string; userId: string; role: "admin" | "user" }): Promise<RunChannelAssessmentItem[]>`**
   - Auth identical to `getRunStatus` (404 if missing, 403 if not owner/admin).
   - `prisma.runChannelAssessment.findMany({ where: { runRequestId: runId }, orderBy: { createdAt: "desc" } })`.
   - Map via `toRunChannelAssessmentItem(row)` helper.

5. **`updateRunBrief(input: { runId: string; userId: string; role; brief: UpdateRunBriefRequest }): Promise<RunMetadataResponse>`**
   - Auth identical.
   - Validate brief via `updateRunBriefRequestSchema`.
   - Convert array fields to `Prisma.InputJsonValue`.
   - `prisma.runRequest.update({ where: { id: runId }, data: { ...brief } })`.
   - Return via `toRunMetadata(updated)`.

6. **`toRunChannelAssessmentItem(row: Prisma.RunChannelAssessment): RunChannelAssessmentItem`** — exported helper that maps a Prisma row to the contract shape. Parse JSON arrays defensively with `z.array(z.string()).safeParse`.

### 4B. Extend `runs/repository.ts`

File: `backend/packages/core/src/runs/repository.ts`

1. Extend `runMetadataSelect` to include 8 new brief columns.
2. Extend `toRunMetadata` to populate the 8 new keys on the response. JSON columns become `string[] | null` via `parseStringArrayOrNull`.
3. Extend `createRunRequest` to accept optional brief fields and pass them to `prisma.runRequest.create`.
4. Re-export `toRunChannelAssessmentItem` from `./assessment`.

### 4C. Export from core index

File: `backend/packages/core/src/runs/index.ts`

Add:

```typescript
export * from "./assessment";
```

### 4D. Tests

File: `backend/packages/core/src/runs/assessment.test.ts` (new)

Unit tests with mocked Prisma and mocked `@scouting-platform/integrations`:

1. `requestRunAssessment` throws `RUN_NOT_FOUND` when run missing.
2. `requestRunAssessment` throws `RUN_FORBIDDEN` for non-owner non-admin.
3. `requestRunAssessment` throws `RUN_NOT_COMPLETED` when status is QUEUED.
4. `requestRunAssessment` throws `RUN_BRIEF_MISSING` when all 8 brief fields are null.
5. Happy path: 3 channels, all missing → 3 rows created with status QUEUED → 3 jobs enqueued → `enqueued: 3, skipped: 0`.
6. Re-trigger: 3 channels with existing COMPLETED rows → all 3 reset to QUEUED, `assessedAt` cleared → 3 jobs enqueued.
7. Mixed: 2 channels QUEUED (no-op), 1 channel COMPLETED (re-queue) → `enqueued: 1, skipped: 2`.
8. Enqueue failure on 1 channel: that row → FAILED with lastError, others succeed.
9. `executeRunChannelFitAssessment` no-ops if row is already COMPLETED.
10. Happy path: claim succeeds → integration returns → row persists as COMPLETED with `model === "gpt-4.1-mini"`, `assessedAt` set, all 5 arrays populated.
11. Rate-limit: integration throws `OPENAI_RATE_LIMITED` → row → FAILED with lastError → re-throws for pg-boss.
12. Payload reuse: prior `rawOpenaiPayloadFetchedAt` set → skips network call → persists COMPLETED with reused profile.
13. Integration auth failure → row FAILED → re-throws.
14. `updateRunBrief` requires auth, validates payload, updates columns, returns updated metadata.
15. `getRunAssessments` returns authorized rows ordered by createdAt desc.

### 4E. Integration test

File: `backend/packages/core/src/runs-assessment.integration.test.ts` (new)

Using `DATABASE_URL_TEST` and the Prisma test client, mock the integration module:

1. Seed user + campaign + runRequest (status=COMPLETED, full brief, 2 results) → call `requestRunAssessment` → assert 2 DB rows with status `QUEUED`.
2. Invoke `executeRunChannelFitAssessment` for each channel → assert both rows transition to `COMPLETED` with `model = "gpt-4.1-mini"`, `fitScore` in range, `assessedAt` set.
3. Re-call `requestRunAssessment` → both rows flip to QUEUED again, `assessedAt` null, `rawOpenaiPayload` preserved (for reuse).
4. Simulate `executeRunChannelFitAssessment` after re-trigger: asserts payload reuse path was taken (integration not called the second time for those rows).

### Session 4 verification

```bash
pnpm --filter @scouting-platform/core exec vitest run src/runs/assessment.test.ts
pnpm --filter @scouting-platform/core exec vitest run src/runs-assessment.integration.test.ts
pnpm --filter @scouting-platform/core typecheck
pnpm --filter @scouting-platform/core lint
```

---

## Session 5 — Worker Registration

**Scope:** pg-boss worker that drains the `runs.assess.channel-fit` queue. Thin — delegates to core.

### 5A. Create the worker

File: `backend/worker/src/runs-assess-channel-fit-worker.ts` (new)

Mirror `backend/worker/src/channels-enrich-llm-worker.ts` line-for-line with these substitutions:
- Job name: `"runs.assess.channel-fit"`.
- Worker options: `runsAssessChannelFitWorkerOptions = { teamSize: 1, teamConcurrency: 2, batchSize: 1 }` (default).
- Handler calls `executeRunChannelFitAssessment(payload)`.
- Error log prefix: `[worker] runs.assess.channel-fit failed for run {runRequestId} channel {channelId}: {message}`.
- Exported function: `registerRunsAssessChannelFitWorker(boss, options)`.

### 5B. Worker test

File: `backend/worker/src/runs-assess-channel-fit-worker.test.ts` (new)

Mirror `channels-enrich-llm-worker.test.ts`. Mock `@scouting-platform/core` module with `executeRunChannelFitAssessment: vi.fn()`. Cases:

1. Registers with correct job name and options.
2. Parses and executes a single job.
3. Parses and executes a batch of two jobs.
4. Logs and re-throws errors so pg-boss retries.

### 5C. Extend runtime config

File: `backend/worker/src/runtime-config.ts`

1. Extend `WorkerRuntimeConfig.jobs` type:

```typescript
runsAssessChannelFit: WorkerJobOptions;
```

2. Extend `getWorkerRuntimeConfig` output:

```typescript
runsAssessChannelFit: buildWorkerJobOptions(
  env,
  "WORKER_RUNS_ASSESS_CHANNEL_FIT_CONCURRENCY",
  2,
),
```

### 5D. Register worker

File: `backend/worker/src/index.ts`

1. Import `registerRunsAssessChannelFitWorker`.
2. In `registerWorkers(boss, config)`:

```typescript
await registerRunsAssessChannelFitWorker(boss, config.jobs.runsAssessChannelFit);
```

### 5E. Runtime config test

File: `backend/worker/src/runtime-config.test.ts` (if it exists — else add to nearest test)

1. Default: `runsAssessChannelFit.teamConcurrency === 2`.
2. With env `WORKER_RUNS_ASSESS_CHANNEL_FIT_CONCURRENCY=5`: `teamConcurrency === 5`.

### Session 5 verification

```bash
pnpm --filter @scouting-platform/worker exec vitest run src/runs-assess-channel-fit-worker.test.ts
pnpm --filter @scouting-platform/worker typecheck
pnpm --filter @scouting-platform/worker build
```

---

## Session 6 — HTTP API

**Scope:** Expose POST `/api/runs/:id/assess`, PATCH `/api/runs/:id/brief`, extend POST `/api/runs` to accept brief fields, and extend GET `/api/runs/:id` response to include assessments.

### 6A. POST `/api/runs/:id/assess`

File: `frontend/web/app/api/runs/[id]/assess/route.ts` (new)

Mirror `frontend/web/app/api/channels/[id]/enrich/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedSession } from "@/lib/auth/session";
import { toRouteErrorResponse } from "@/lib/errors/route-error";
import { requestRunAssessment } from "@scouting-platform/core";
import { triggerRunAssessmentResponseSchema } from "@scouting-platform/contracts";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuthenticatedSession();
    const params = await context.params;
    const parsed = paramsSchema.safeParse(params);
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_RUN_ID" }, { status: 400 });
    }
    const result = await requestRunAssessment({
      runId: parsed.data.id,
      userId: session.userId,
      role: session.role,
    });
    const payload = triggerRunAssessmentResponseSchema.parse(result);
    return NextResponse.json(payload, { status: 202 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
```

### 6B. PATCH `/api/runs/:id/brief`

File: `frontend/web/app/api/runs/[id]/brief/route.ts` (new)

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuthenticatedSession } from "@/lib/auth/session";
import { toRouteErrorResponse } from "@/lib/errors/route-error";
import { updateRunBrief } from "@scouting-platform/core";
import {
  runMetadataResponseSchema,
  updateRunBriefRequestSchema,
} from "@scouting-platform/contracts";

const paramsSchema = z.object({ id: z.string().uuid() });

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await requireAuthenticatedSession();
    const params = await context.params;
    const parsedParams = paramsSchema.safeParse(params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "INVALID_RUN_ID" }, { status: 400 });
    }
    const body = await req.json();
    const parsedBody = updateRunBriefRequestSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "INVALID_BRIEF", details: parsedBody.error.issues },
        { status: 400 },
      );
    }
    const result = await updateRunBrief({
      runId: parsedParams.data.id,
      userId: session.userId,
      role: session.role,
      brief: parsedBody.data,
    });
    const payload = runMetadataResponseSchema.parse(result);
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return toRouteErrorResponse(error);
  }
}
```

### 6C. Extend POST `/api/runs`

File: `frontend/web/app/api/runs/route.ts`

Update the POST handler to pass brief fields to `createRunRequest`. Since `createRunRequestSchema` is already extended in Session 2, the parsed body will include brief fields automatically — only change is in `createRunRequest` to pass them through (Session 4 handles that).

### 6D. Extend GET `/api/runs/:id`

File: `backend/packages/core/src/runs/repository.ts` (already modified in Session 4)

Further extend `getRunStatus`:

1. Add `channelAssessments` to the `select` with all fields needed by `runChannelAssessmentItemSchema`.
2. Append `assessments` to the return object:

```typescript
return {
  // ... existing fields
  assessments: runRequest.channelAssessments.map(toRunChannelAssessmentItem),
};
```

File: `shared/packages/contracts/src/runs.ts`

Extend `runStatusResponseSchema` by adding:

```typescript
assessments: z.array(runChannelAssessmentItemSchema).optional().default([]),
```

Import `runChannelAssessmentItemSchema` from `./runs-assessment`.

### 6E. Tests

File: `frontend/web/app/api/runs-assessment.integration.test.ts` (new) or extend existing week-4 integration test.

Cases:

1. POST `/api/runs/:id/assess` without auth → 401.
2. POST as non-owner non-admin → 403.
3. POST when run status ≠ COMPLETED → 409 with `RUN_NOT_COMPLETED`.
4. POST when brief is empty → 400 with `RUN_BRIEF_MISSING`.
5. POST happy path → 202 with `enqueued === resultCount`, DB rows created.
6. GET `/api/runs/:id` → returns `assessments: []` when none exist.
7. GET after assess → returns `assessments` array shaped per contract.
8. PATCH `/api/runs/:id/brief` without auth → 401.
9. PATCH with empty body (no fields) → 400.
10. PATCH with valid brief → 200 + metadata updated.
11. POST `/api/runs` with brief fields → run created with brief populated.

### Session 6 verification

```bash
pnpm --filter @scouting-platform/web exec vitest run app/api/runs-assessment.integration.test.ts
pnpm --filter @scouting-platform/web typecheck
pnpm --filter @scouting-platform/web lint
pnpm --filter @scouting-platform/contracts exec vitest run
```

---

## Session 7 — E2E Integration + Observability + ADR Note

**Scope:** Full-pipeline integration test, ADR note, confirm telemetry knobs.

### 7A. End-to-end integration test

File: `backend/packages/core/src/runs-assessment-e2e.integration.test.ts` (new)

Using `DATABASE_URL_TEST`:

1. Seed admin user, campaign, runRequest (status=COMPLETED, 2 results, fully populated brief).
2. Mock `enrichCampaignFitWithOpenAi` via `vi.mock` to return deterministic profiles:
   - Channel A: `fitScore: 0.75, fitReasons: ["Aligned audience"], ...`.
   - Channel B: `fitScore: 0.30, fitReasons: ["Audience mismatch"], ...`.
3. Call `requestRunAssessment` → assert 2 rows `QUEUED`.
4. For each, call `executeRunChannelFitAssessment` directly (simulating worker) → assert both `COMPLETED`, `model = "gpt-4.1-mini"`, `assessedAt` set, `fitScore` matches mock.
5. Call `getRunAssessments` → returns both ordered `createdAt DESC`.
6. Re-call `requestRunAssessment` → both rows reset to `QUEUED`, `assessedAt = null`.
7. Simulate integration throwing `OPENAI_RATE_LIMITED` → row → `FAILED` with `lastError`, re-throws.

### 7B. ADR-002 update

File: `docs/ADR-002-data-ownership-and-precedence.md`

Append section after "Operational rules":

```markdown
### Run-scoped artifacts

Run-scoped artifacts like `run_channel_assessments` are non-canonical per-run snapshots. They never feed back into the catalog, never influence resolved channel state, and are not subject to the precedence order above. They exist to record a judgment made at a specific point in time for a specific campaign and may be safely discarded without catalog impact.
```

### 7C. Runtime config test

Confirm `backend/worker/src/runtime-config.test.ts` (or equivalent) asserts:

1. Default `runsAssessChannelFit.teamConcurrency === 2`.
2. `WORKER_RUNS_ASSESS_CHANNEL_FIT_CONCURRENCY=5` overrides to 5.

If no runtime-config test file exists, skip — already covered in Session 5.

### Session 7 verification

```bash
pnpm lint
pnpm typecheck
pnpm test:ci
pnpm db:migrate:test
```

---

## Post-Implementation Verification

Run in order from the repo root:

1. `pnpm db:validate` — Prisma schema parses.
2. `pnpm db:migrate:test` — migration applies cleanly against a fresh DB.
3. `pnpm --filter @scouting-platform/contracts exec vitest run` — contract schemas locked.
4. `pnpm --filter @scouting-platform/integrations exec vitest run` — **CRITICAL:** model-lock test passes with `OPENAI_MODEL=gpt-5` in env.
5. `pnpm --filter @scouting-platform/core exec vitest run` — core unit + integration tests.
6. `pnpm --filter @scouting-platform/worker exec vitest run` — worker registration + payload parsing.
7. `pnpm --filter @scouting-platform/web exec vitest run` — API route integration tests.
8. `pnpm typecheck` — project-wide.
9. `pnpm lint` — project-wide.
10. **Manual smoke:**
    - Seed a completed run locally with a populated brief.
    - Set `OPENAI_API_KEY` in env.
    - `curl -X POST http://localhost:3000/api/runs/<id>/assess` (with auth cookie).
    - Verify worker logs `[provider_spend] provider=openai operation=assess_run_channel_fit outcome=fresh_call`.
    - Query `SELECT status, model, fit_score, assessed_at FROM run_channel_assessments WHERE run_request_id = '<id>'` — all rows `COMPLETED` with `model = 'gpt-4.1-mini'`.

## Exit Criteria

- All 7 session verification commands pass.
- Model-lock test passes with `OPENAI_MODEL=gpt-5` in env (proves env cannot override).
- Re-triggering assessment on a completed run cleanly resets prior rows to QUEUED without orphaning data.
- End-to-end integration test passes.
- ADR-002 has the "Run-scoped artifacts" section.

---

## What This Plan Does NOT Cover

Explicitly deferred to follow-up work:

- **Frontend UI** — no brief-entry form, no trigger button, no fit-score column in the catalog, no per-channel reasoning drawer. A separate plan titled "Campaign-aware assessment UI" covers surfacing.
- **HubSpot push of fit score** — no property mapping, no push-batch changes. A separate plan titled "HubSpot fit-score note push" decides whether fit data becomes a HubSpot note, a custom property, or a deal task.
- **Multi-campaign brief templates / reusable briefs** — brief is flat columns on `run_requests`, not a normalized `campaign_briefs` table. Promotion happens when a brief outlives a single run.
- **Enum promotion** — `budgetTier` and geography codes are free-text. Promotion to Prisma enums or FK reference tables follows shape stabilization.
- **Auto-trigger** — trigger is manual only. No listener on `RunResult` inserts, no run-completion hook.
- **Bulk re-assessment across runs** — one run at a time. Cross-run admin tooling is separate.
- **Cost ceilings / approval workflow** — assessments run freely for authorized users, no spend limit.
- **Model A/B testing / alternative models** — model is hardcoded. Any future model change is a one-line constant change, deliberately requiring a code commit + review.
- **Streaming responses / partial output** — single-shot JSON only.
- **Prompt-version audit log** — `rawOpenaiPayload` captures the response; prompts reconstruct from code history.

---

## Critical Files Reference

### New files (to create)

- `backend/packages/db/prisma/migrations/20260415120000_run_channel_assessments_and_brief_fields/migration.sql`
- `backend/packages/integrations/src/openai/campaign-fit-assessment.ts`
- `backend/packages/integrations/src/openai/campaign-fit-assessment.test.ts`
- `backend/packages/core/src/runs/assessment.ts`
- `backend/packages/core/src/runs/assessment.test.ts`
- `backend/packages/core/src/runs-assessment.integration.test.ts`
- `backend/packages/core/src/runs-assessment-e2e.integration.test.ts`
- `backend/worker/src/runs-assess-channel-fit-worker.ts`
- `backend/worker/src/runs-assess-channel-fit-worker.test.ts`
- `shared/packages/contracts/src/runs-assessment.ts`
- `shared/packages/contracts/src/runs-assessment.test.ts`
- `frontend/web/app/api/runs/[id]/assess/route.ts`
- `frontend/web/app/api/runs/[id]/brief/route.ts`
- `frontend/web/app/api/runs-assessment.integration.test.ts`

### Modified files

- `backend/packages/db/prisma/schema.prisma` — RunRequest fields, RunChannelAssessment model, enum, Channel back-relation.
- `backend/packages/db/src/migrations.test.ts` — migration assertions.
- `backend/packages/core/src/runs/repository.ts` — metadata select, toRunMetadata, createRunRequest, getRunStatus with assessments.
- `backend/packages/core/src/runs/index.ts` — re-export assessment module.
- `backend/worker/src/runtime-config.ts` — add `runsAssessChannelFit`.
- `backend/worker/src/index.ts` — register new worker.
- `shared/packages/contracts/src/runs.ts` — brief fields in metadata + create + update schemas; assessments array on status response.
- `shared/packages/contracts/src/jobs.ts` — new job name + payload schema.
- `shared/packages/contracts/src/index.ts` — export new module and schemas.
- `backend/packages/integrations/src/index.ts` — export new integration.
- `frontend/web/app/api/runs/route.ts` — pass brief to createRunRequest.
- `docs/ADR-002-data-ownership-and-precedence.md` — append run-scoped artifacts section.

### Read-only reference files

- `backend/packages/integrations/src/openai/channel-enrichment.ts` — structural mirror for the new integration.
- `backend/packages/core/src/enrichment/index.ts` (lines 307–638) — structural mirror for `executeRunChannelFitAssessment`.
- `backend/worker/src/channels-enrich-llm-worker.ts` — structural mirror for the new worker.
- `frontend/web/app/api/channels/[id]/enrich/route.ts` — structural mirror for the new POST route.
