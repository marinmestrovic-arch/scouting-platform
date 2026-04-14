# Codex Implementation Guide: HubSpot Property Alignment & Enrichment Expansion

- Status: Not Started
- Date: 2026-04-14
- Owner: Ivan

---

## Context

An audit of the HubSpot integration revealed that:

1. The HubSpot push writes to 10 custom property names (`channel_id`, `youtube_channel_id`,
   `creator_title`, `creator_handle`, `subscriber_count`, `view_count`, `video_count`,
   `enrichment_summary`, `enrichment_topics`, `brand_fit_notes`) that **do not exist** in HubSpot.
   HubSpot silently ignores unknown properties in PATCH requests, so the push appears to succeed
   but writes nothing useful.

2. HubSpot already has a well-structured set of custom properties designed for influencer
   management — enumerations with curated option lists, numeric fields for metrics, and text
   fields for URLs. The platform ignores all of them.

3. The OpenAI enrichment produces free-text output (`summary`, `topics`, `brandFitNotes`,
   `confidence`) that cannot populate HubSpot's enumeration dropdowns. Campaign managers
   cannot filter creators by vertical, size, language, or type in HubSpot.

4. The platform's `influencerVertical` dropdown has 5 values (Gaming, Lifestyle, Beauty, Tech,
   General) while HubSpot has 70+ verticals. The `influencerType` dropdown uses a completely
   different taxonomy (YouTube Creator / Streamer / Podcaster) than HubSpot (Male / Female /
   Couple / Family / Team / Animation / Kids / Faceless / Duo). These mismatches mean even
   manually-set values don't transfer cleanly.

### HubSpot Properties That Already Exist (Reference)

**Enumeration dropdowns (searchable/filterable):**

- `influencer_vertical` — 70+ values: Abandoned Places, Adventure, Animals, Animations, Anime,
  Art, ASMR, Astrology, Aviation, Books, Budgeting, Cars, Chess, Commentary, Conspiracy,
  Construction, Cosplay, Crimes, Cybersecurity, Cycling, Dance, DIY, Documentary, Editing,
  Education, Engineering, Entertainment, Environment, Family, Fashion, Finance, Fishing, Fitness,
  Food, Football, Gaming, Guitars, Health, History, Home Decor, Home Renovation, Humor, Hunting,
  Infotainment, Interview, Journalism, Just Chatting, Kids, Lego, Lifestyle, Minecraft,
  Motivation, Movies, Music, Mystery, News, Outdoor, Painting, Parenting, Pets, Photography,
  Plants, Podcast, Pokemon Cards, Politics, Pop Culture, Reviews, Science, Society, Sport, TCG,
  Tech, Travel, Variety, Vlog, Yoga
- `influencer_type` — Male, Female, Couple, Family, Team, Animation, Kids, Faceless, Duo
- `influencer_size` — Nano (1K - 5K), Micro (5K - 20K), Mid-tier (20K - 100K),
  Macro (100K - 500K), Mega (500K - 1M), Macro-tier (1M+)
- `language` — 40+ values: English (US), English (UK), Spanish, French, German, Italian,
  Portuguese, Dutch, Swedish, Danish, Norwegian, Finnish, Polish, Czech, Slovak, Hungarian,
  Romanian, Bulgarian, Croatian, Serbian, Slovenian, Albanian, Greek, Ukrainian, Russian, Turkish,
  Arabic, Hebrew, Hindi, Bengali, Tamil, Telugu, Marathi, Urdu, Indonesian, Malay, Thai,
  Vietnamese, Filipino, Chinese, Japanese, Korean
- `platforms` — YouTube, Instagram, TikTok, Twitter, Twitch, Kick
- `contact_type` — Influencer, Agent, Client, Partner

**Numeric fields:**

- `youtube_followers` (number)
- `youtube_video_average_views` (number)
- `youtube_video_median_views` (number)
- `youtube_engagement_rate` (number)
- `youtube_shorts_average_views` (number)
- `youtube_shorts_median_views` (number)
- `instagram_followers` (number)
- `instagram_engagement_rate` (number)
- `tiktok_followers` (number)
- `twitch_followers` (number)

**Text fields:**

- `youtube_url` (string)
- `youtube_handle` (string)
- `influencer_url` (string — labeled "Social Media Link")

**Date fields:**

- `last_updated_youtube_video_average_views` (date)

---

## Architectural Guardrails

- ADR-002 precedence rules are unchanged: admin manual > CSV import > HypeAuditor > LLM >
  heuristics > YouTube raw
- Catalog remains canonical; HubSpot is a downstream consumer
- Existing enrichment fields (`summary`, `topics`, `brandFitNotes`, `confidence`) remain as-is.
  New structured fields are additive
- The HubSpot push path (`buildHubspotContactProperties` + `upsertHubspotContact`) stays
  unchanged in shape — only the property name mapping changes
- No new queue families, no new worker processes
- No frontend changes in this plan
- The `channels.enrich.llm` worker remains the single enrichment execution path
- New enrichment output fields are stored in the existing `channel_enrichments` table

---

## Delivery Shape

This work is split into **five sessions** that must be executed in order. Each session is
self-contained and testable before the next begins.

| Session | Scope | Risk |
|---------|-------|------|
| 1 | Fix HubSpot property mapping + push metrics | Zero — code-only, no schema changes |
| 2 | Add `influencer_size` tier computation | Zero — pure derivation logic |
| 3 | Schema migration for new enrichment fields | Low — additive nullable columns |
| 4 | Expand OpenAI prompt with constrained outputs | Medium — prompt changes affect output |
| 5 | Wire new enrichment fields to HubSpot push | Low — extends Session 1 mapping |

---

## Session 1 — Fix HubSpot Property Mapping

**Scope:** Rewrite `buildHubspotContactProperties()` to push to property names that actually exist
in HubSpot. Push YouTube metrics that are already computed in `ChannelMetric` but currently not
sent. No schema changes.

### 1A. Update the channel push select

File: `backend/packages/core/src/hubspot/index.ts`

Expand `channelPushSelect` to include the additional metric fields needed for the new mapping:

```typescript
const channelPushSelect = {
  id: true,
  youtubeChannelId: true,
  title: true,
  handle: true,
  youtubeUrl: true,
  contacts: {
    orderBy: {
      email: "asc",
    },
    select: {
      email: true,
    },
  },
  metrics: {
    select: {
      subscriberCount: true,
      viewCount: true,
      videoCount: true,
      youtubeAverageViews: true,
      youtubeEngagementRate: true,
      youtubeFollowers: true,
    },
  },
  enrichment: {
    select: {
      summary: true,
      topics: true,
      brandFitNotes: true,
    },
  },
} as const;
```

Changes vs current:
- Added `youtubeUrl: true` to channel select
- Added `youtubeAverageViews`, `youtubeEngagementRate`, `youtubeFollowers` to metrics select

### 1B. Rewrite `buildHubspotContactProperties`

File: `backend/packages/core/src/hubspot/index.ts`

Replace the current `buildHubspotContactProperties` function with:

```typescript
export function buildHubspotContactProperties(channel: PushChannelRecord): Record<string, string> {
  const subscriberCount = channel.metrics?.subscriberCount;

  return {
    email: channel.contacts[0]?.email ?? "",
    contact_type: "Influencer",
    platforms: "YouTube",
    youtube_url: channel.youtubeUrl ?? `https://www.youtube.com/channel/${channel.youtubeChannelId}`,
    youtube_handle: channel.handle ?? "",
    influencer_url: channel.youtubeUrl ?? `https://www.youtube.com/channel/${channel.youtubeChannelId}`,
    youtube_followers: channel.metrics?.youtubeFollowers?.toString()
      ?? subscriberCount?.toString()
      ?? "",
    youtube_video_average_views: channel.metrics?.youtubeAverageViews?.toString() ?? "",
    youtube_engagement_rate: channel.metrics?.youtubeEngagementRate?.toString() ?? "",
    influencer_size: computeInfluencerSizeTier(subscriberCount),
  };
}
```

Note: `computeInfluencerSizeTier` is defined in Session 2. For Session 1, add a temporary inline
implementation at the top of the function:

```typescript
function computeInfluencerSizeTier(subscriberCount: bigint | null | undefined): string {
  if (subscriberCount === null || subscriberCount === undefined) {
    return "";
  }

  const count = Number(subscriberCount);

  if (count >= 1_000_000) return "Macro-tier (1M+)";
  if (count >= 500_000) return "Mega (500K - 1M)";
  if (count >= 100_000) return "Macro (100K - 500K)";
  if (count >= 20_000) return "Mid-tier (20K - 100K)";
  if (count >= 5_000) return "Micro (5K - 20K)";
  if (count >= 1_000) return "Nano (1K - 5K)";
  return "";
}
```

The tier labels **must** match the exact HubSpot `influencer_size` enum values listed above.
Do not invent new labels.

### 1C. Tests

File: `backend/packages/core/src/hubspot/index.test.ts` (create if it does not exist)

Test `buildHubspotContactProperties`:

1. **Maps YouTube metrics to correct HubSpot property names**
   Input: channel with `youtubeUrl`, `handle`, `youtubeFollowers: 150000n`, `youtubeAverageViews: 25000n`, `youtubeEngagementRate: 3.5`.
   Assert: output contains `youtube_url`, `youtube_handle`, `youtube_followers: "150000"`,
   `youtube_video_average_views: "25000"`, `youtube_engagement_rate: "3.5"`.

2. **Sets contact_type to Influencer and platforms to YouTube**
   Assert: `contact_type === "Influencer"`, `platforms === "YouTube"`.

3. **Falls back to channel ID URL when youtubeUrl is null**
   Input: `youtubeUrl: null`, `youtubeChannelId: "UCxyz"`.
   Assert: `youtube_url` and `influencer_url` both equal `"https://www.youtube.com/channel/UCxyz"`.

4. **Returns empty strings for missing metrics**
   Input: `metrics: null`.
   Assert: `youtube_followers === ""`, `youtube_video_average_views === ""`, etc.

5. **Computes influencer_size tier correctly**
   Test each tier boundary: 500 (empty), 1000 (Nano), 5000 (Micro), 20000 (Mid-tier),
   100000 (Macro), 500000 (Mega), 1000000 (Macro-tier).

6. **Does NOT include old property names**
   Assert: output does not have keys `channel_id`, `youtube_channel_id`, `creator_title`,
   `creator_handle`, `subscriber_count`, `view_count`, `video_count`, `enrichment_summary`,
   `enrichment_topics`, or `brand_fit_notes`.

### Session 1 verification

```bash
pnpm --filter @scouting-platform/core typecheck
pnpm --filter @scouting-platform/core exec vitest run src/hubspot
```

---

## Session 2 — Influencer Size Tier as a Shared Utility

**Scope:** Extract the `computeInfluencerSizeTier` function from Session 1's inline location into
a shared utility so it can be reused by the enrichment pipeline and tested independently.

### 2A. Create the utility

File: `backend/packages/core/src/hubspot/influencer-size.ts` (new file)

```typescript
const INFLUENCER_SIZE_TIERS = [
  { min: 1_000_000, label: "Macro-tier (1M+)" },
  { min: 500_000, label: "Mega (500K - 1M)" },
  { min: 100_000, label: "Macro (100K - 500K)" },
  { min: 20_000, label: "Mid-tier (20K - 100K)" },
  { min: 5_000, label: "Micro (5K - 20K)" },
  { min: 1_000, label: "Nano (1K - 5K)" },
] as const;

export type InfluencerSizeTier = (typeof INFLUENCER_SIZE_TIERS)[number]["label"];

export function computeInfluencerSizeTier(
  subscriberCount: bigint | number | null | undefined,
): string {
  if (subscriberCount === null || subscriberCount === undefined) {
    return "";
  }

  const count = Number(subscriberCount);

  if (!Number.isFinite(count) || count < 0) {
    return "";
  }

  for (const tier of INFLUENCER_SIZE_TIERS) {
    if (count >= tier.min) {
      return tier.label;
    }
  }

  return "";
}
```

### 2B. Wire into HubSpot push

File: `backend/packages/core/src/hubspot/index.ts`

- Add `import { computeInfluencerSizeTier } from "./influencer-size";` at the top
- Remove the inline `computeInfluencerSizeTier` function added in Session 1
- Keep the `buildHubspotContactProperties` call to `computeInfluencerSizeTier` unchanged

### 2C. Tests

File: `backend/packages/core/src/hubspot/influencer-size.test.ts` (new file)

1. **Returns empty string for null/undefined** — `null` and `undefined` both return `""`
2. **Returns empty string for sub-1K counts** — `999` returns `""`
3. **Returns correct tier for each boundary** — test 1000, 4999, 5000, 19999, 20000, 99999,
   100000, 499999, 500000, 999999, 1000000, 5000000
4. **Handles bigint input** — `BigInt(250000)` returns `"Macro (100K - 500K)"`
5. **Returns empty string for negative or NaN** — `-1`, `NaN`, `Infinity` all return `""`

### Session 2 verification

```bash
pnpm --filter @scouting-platform/core typecheck
pnpm --filter @scouting-platform/core exec vitest run src/hubspot
```

---

## Session 3 — Schema Migration for Enrichment Structured Fields

**Scope:** Add nullable columns to `channel_enrichments` for the new LLM-derived structured
fields that will map to HubSpot dropdowns. No execution logic changes.

### 3A. Prisma schema changes

File: `backend/packages/db/prisma/schema.prisma`

Add the following nullable fields to the `ChannelEnrichment` model, after the `confidence` field:

```prisma
hubspotVertical      String?   @map("hubspot_vertical")
hubspotInfluencerType String?  @map("hubspot_influencer_type")
contentLanguage      String?   @map("content_language")
brandSafetyStatus    String?   @map("brand_safety_status")
brandSafetyFlags     Json?     @map("brand_safety_flags")
```

**Field semantics:**

- `hubspotVertical` — One of the 70+ HubSpot `influencer_vertical` enum values. LLM picks the
  best match from the constrained list. Stored as a plain string so it can be pushed directly
  to HubSpot without mapping.
- `hubspotInfluencerType` — One of the HubSpot `influencer_type` enum values (Male, Female,
  Couple, Family, Team, Animation, Kids, Faceless, Duo). LLM classifies from channel context.
- `contentLanguage` — One of the HubSpot `language` enum values. LLM identifies the primary
  content language.
- `brandSafetyStatus` — One of: `safe`, `caution`, `not_recommended`. Structured version of
  the existing free-text `brandFitNotes`.
- `brandSafetyFlags` — JSON array of string flags (e.g. `["violence", "profanity"]`). Pairs
  with `brandSafetyStatus` to explain the classification.

### 3B. Migration file

Create directory and file:
`backend/packages/db/prisma/migrations/20260414120000_enrichment_hubspot_fields/migration.sql`

```sql
ALTER TABLE "channel_enrichments"
  ADD COLUMN "hubspot_vertical"       TEXT,
  ADD COLUMN "hubspot_influencer_type" TEXT,
  ADD COLUMN "content_language"       TEXT,
  ADD COLUMN "brand_safety_status"    TEXT,
  ADD COLUMN "brand_safety_flags"     JSONB;
```

### 3C. Contract additions

File: `shared/packages/contracts/src/channels.ts`

Find the channel enrichment detail schema (the shape returned by `GET /api/channels/:id` that
includes `summary`, `topics`, `brandFitNotes`, `confidence`). Add the new fields as nullable:

```typescript
hubspotVertical: z.string().nullable(),
hubspotInfluencerType: z.string().nullable(),
contentLanguage: z.string().nullable(),
brandSafetyStatus: z.enum(["safe", "caution", "not_recommended"]).nullable(),
brandSafetyFlags: z.array(z.string()).nullable(),
```

Update the corresponding select in the channel detail query
(`backend/packages/core/src/channels/repository.ts` or wherever the enrichment detail is built)
to include the new fields. Map them into the response with `?? null` fallbacks.

### 3D. Migration test

File: `backend/packages/db/src/migrations.test.ts`

Add a test case for `20260414120000_enrichment_hubspot_fields`:

- Assert migration SQL contains `ADD COLUMN "hubspot_vertical"`
- Assert migration SQL contains `ADD COLUMN "hubspot_influencer_type"`
- Assert migration SQL contains `ADD COLUMN "content_language"`
- Assert migration SQL contains `ADD COLUMN "brand_safety_status"`
- Assert migration SQL contains `ADD COLUMN "brand_safety_flags"`

### Session 3 verification

```bash
pnpm db:migrate:test
pnpm --filter @scouting-platform/db typecheck
pnpm --filter @scouting-platform/db exec vitest run src/migrations.test.ts
pnpm --filter @scouting-platform/core typecheck
pnpm --filter @scouting-platform/contracts typecheck
```

---

## Session 4 — Expand OpenAI Enrichment with Constrained Outputs

**Scope:** Modify the OpenAI prompt and output schema to produce structured fields that match
HubSpot's enum values exactly. Update the enrichment execution to persist the new fields.

### 4A. Define the constrained value lists

File: `backend/packages/integrations/src/openai/channel-enrichment.ts`

Add the following constants before the `outputSchema`:

```typescript
const HUBSPOT_VERTICALS = [
  "Abandoned Places", "Adventure", "Animals", "Animations", "Anime", "Art", "ASMR",
  "Astrology", "Aviation", "Books", "Budgeting", "Cars", "Chess", "Commentary",
  "Conspiracy", "Construction", "Cosplay", "Crimes", "Cybersecurity", "Cycling",
  "Dance", "DIY", "Documentary", "Editing", "Education", "Engineering",
  "Entertainment", "Environment", "Family", "Fashion", "Finance", "Fishing",
  "Fitness", "Food", "Football", "Gaming", "Guitars", "Health", "History",
  "Home Decor", "Home Renovation", "Humor", "Hunting", "Infotainment", "Interview",
  "Journalism", "Just Chatting", "Kids", "Lego", "Lifestyle", "Minecraft",
  "Motivation", "Movies", "Music", "Mystery", "News", "Outdoor", "Painting",
  "Parenting", "Pets", "Photography", "Plants", "Podcast", "Pokemon Cards",
  "Politics", "Pop Culture", "Reviews", "Science", "Society", "Sport", "TCG",
  "Tech", "Travel", "Variety", "Vlog", "Yoga",
] as const;

const HUBSPOT_INFLUENCER_TYPES = [
  "Male", "Female", "Couple", "Family", "Team", "Animation", "Kids", "Faceless", "Duo",
] as const;

const HUBSPOT_LANGUAGES = [
  "English (US)", "English (UK)", "Spanish", "French", "German", "Italian", "Portuguese",
  "Dutch", "Swedish", "Danish", "Norwegian", "Finnish", "Polish", "Czech", "Slovak",
  "Hungarian", "Romanian", "Bulgarian", "Croatian", "Serbian", "Slovenian", "Albanian",
  "Greek", "Ukrainian", "Russian", "Turkish", "Arabic", "Hebrew", "Hindi", "Bengali",
  "Tamil", "Telugu", "Marathi", "Urdu", "Indonesian", "Malay", "Thai", "Vietnamese",
  "Filipino", "Chinese", "Japanese", "Korean",
] as const;

const BRAND_SAFETY_STATUSES = ["safe", "caution", "not_recommended"] as const;
```

### 4B. Expand the output schema

File: `backend/packages/integrations/src/openai/channel-enrichment.ts`

Extend the existing `outputSchema` with the new fields. The existing four fields remain required.
The new fields are **optional** so the enrichment does not fail if the LLM omits them:

```typescript
const outputSchema = z.object({
  summary: z.string().trim().min(1),
  topics: z.array(z.string().trim().min(1)).min(1).max(20),
  brandFitNotes: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
  hubspotVertical: z.string().trim().optional().default(""),
  hubspotInfluencerType: z.string().trim().optional().default(""),
  contentLanguage: z.string().trim().optional().default(""),
  brandSafetyStatus: z.enum(BRAND_SAFETY_STATUSES).optional().default("safe"),
  brandSafetyFlags: z.array(z.string().trim()).optional().default([]),
});
```

### 4C. Update the prompt

File: `backend/packages/integrations/src/openai/channel-enrichment.ts`

Update the `buildPrompt` function to include instructions for the new fields with constrained
value lists:

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
      hubspotVertical:
        `Pick the SINGLE best-matching content vertical from this EXACT list. Return the exact string, do not invent new values: ${JSON.stringify(HUBSPOT_VERTICALS)}`,
      hubspotInfluencerType:
        `Classify the creator's on-screen presentation from this EXACT list. Return the exact string: ${JSON.stringify(HUBSPOT_INFLUENCER_TYPES)}`,
      contentLanguage:
        `Identify the primary language the creator speaks in their content. Pick from this EXACT list. Return the exact string: ${JSON.stringify(HUBSPOT_LANGUAGES)}`,
      brandSafetyStatus:
        'Classify brand safety as exactly one of: "safe", "caution", "not_recommended". Use "caution" for mature themes, controversial topics, or frequent profanity. Use "not_recommended" for extreme content, hate speech, or illegal activity.',
      brandSafetyFlags:
        'If brandSafetyStatus is not "safe", list the specific flags (e.g. "violence", "profanity", "drugs", "politics", "gambling", "sexual_content"). Return an empty array for "safe" creators.',
    },
  });
}
```

### 4D. Update the system message

File: `backend/packages/integrations/src/openai/channel-enrichment.ts`

Update the system message in `enrichChannelWithOpenAi` to mention the new fields:

```typescript
{
  role: "system",
  content:
    "You analyze creator-channel context and must return valid JSON with summary, topics, brandFitNotes, confidence, hubspotVertical, hubspotInfluencerType, contentLanguage, brandSafetyStatus, and brandSafetyFlags.",
},
```

### 4E. Persist new fields in enrichment execution

File: `backend/packages/core/src/enrichment/index.ts`

In `executeChannelLlmEnrichment`, find the `channelEnrichment` update inside the final
transaction (the one that writes `summary`, `topics`, `brandFitNotes`, `confidence`). Add the
new fields:

```typescript
await tx.channelEnrichment.update({
  where: { channelId: input.channelId },
  data: {
    // ... existing fields ...
    summary: enrichmentResult.profile.summary,
    topics: enrichmentResult.profile.topics,
    brandFitNotes: enrichmentResult.profile.brandFitNotes,
    confidence: enrichmentResult.profile.confidence,
    hubspotVertical: enrichmentResult.profile.hubspotVertical || null,
    hubspotInfluencerType: enrichmentResult.profile.hubspotInfluencerType || null,
    contentLanguage: enrichmentResult.profile.contentLanguage || null,
    brandSafetyStatus: enrichmentResult.profile.brandSafetyStatus === "safe" ? null : enrichmentResult.profile.brandSafetyStatus,
    brandSafetyFlags: enrichmentResult.profile.brandSafetyFlags.length > 0
      ? enrichmentResult.profile.brandSafetyFlags
      : undefined,
    // ... existing fields ...
  },
});
```

Note: `brandSafetyStatus` stores `null` for "safe" creators to keep the common case clean.
The push layer (Session 5) treats `null` as "safe".

### 4F. Update the OpenAI profile type export

File: `backend/packages/integrations/src/openai/channel-enrichment.ts`

The existing `OpenAiChannelEnrichment` type is inferred from `outputSchema`. Because the schema
now includes the new fields, the type automatically includes them. No explicit change needed
here, but verify that `extractOpenAiChannelEnrichmentProfileFromRawPayload` still works by
running existing tests.

### 4G. Tests

File: `backend/packages/integrations/src/openai/channel-enrichment.test.ts`

Add test cases:

1. **Prompt includes constrained value lists**
   Capture the prompt JSON. Assert it contains `hubspotVertical`, `hubspotInfluencerType`,
   `contentLanguage`, `brandSafetyStatus`, `brandSafetyFlags` instruction keys.
   Assert the `hubspotVertical` instruction string contains `"Gaming"` and `"ASMR"`.

2. **Parses new fields from valid OpenAI response**
   Mock response with `hubspotVertical: "Gaming"`, `hubspotInfluencerType: "Male"`,
   `contentLanguage: "English (US)"`, `brandSafetyStatus: "caution"`,
   `brandSafetyFlags: ["violence"]`.
   Assert parsed profile contains all fields correctly.

3. **Defaults missing new fields gracefully**
   Mock response WITHOUT the new fields (only `summary`, `topics`, `brandFitNotes`, `confidence`).
   Assert: `hubspotVertical === ""`, `brandSafetyStatus === "safe"`, `brandSafetyFlags === []`.
   This ensures backward compatibility with cached raw payloads.

4. **Rejects invalid brandSafetyStatus value**
   Mock response with `brandSafetyStatus: "dangerous"`.
   Assert: parsing still succeeds because the schema defaults to `"safe"` via `.optional().default("safe")`.
   (Verify this is the desired fallback behavior and adjust schema if strict validation is preferred.)

### Session 4 verification

```bash
pnpm --filter @scouting-platform/integrations typecheck
pnpm --filter @scouting-platform/integrations exec vitest run src/openai/channel-enrichment.test.ts
pnpm --filter @scouting-platform/core typecheck
```

---

## Session 5 — Wire New Enrichment Fields to HubSpot Push

**Scope:** Extend the HubSpot push to include the new enrichment-derived fields so creators
become searchable by vertical, type, and language in HubSpot.

### 5A. Expand push select to include new enrichment fields

File: `backend/packages/core/src/hubspot/index.ts`

Add the new fields to the `enrichment` select inside `channelPushSelect`:

```typescript
enrichment: {
  select: {
    summary: true,
    topics: true,
    brandFitNotes: true,
    hubspotVertical: true,
    hubspotInfluencerType: true,
    contentLanguage: true,
    brandSafetyStatus: true,
  },
},
```

### 5B. Extend `buildHubspotContactProperties`

File: `backend/packages/core/src/hubspot/index.ts`

Add the new fields to the returned properties object inside `buildHubspotContactProperties`:

```typescript
// Add after the existing properties:
influencer_vertical: channel.enrichment?.hubspotVertical ?? "",
influencer_type: channel.enrichment?.hubspotInfluencerType ?? "",
language: channel.enrichment?.contentLanguage ?? "",
```

Do NOT push `brandSafetyStatus` or `brandSafetyFlags` to HubSpot — these properties do not
exist in HubSpot and are for internal platform use only.

### 5C. Validate enum values before push

Add a validation helper to ensure only valid HubSpot enum values are pushed. Invalid values
would cause HubSpot to silently ignore the property:

File: `backend/packages/core/src/hubspot/index.ts`

```typescript
function cleanHubspotEnumValue(value: string | null | undefined): string {
  return value?.trim() ?? "";
}
```

Use this in `buildHubspotContactProperties` for the enum fields. The LLM is instructed to return
exact values, but this is a safety net.

### 5D. Tests

File: `backend/packages/core/src/hubspot/index.test.ts`

Add test cases:

1. **Includes enrichment-derived HubSpot fields**
   Input: channel with `enrichment.hubspotVertical: "Gaming"`,
   `enrichment.hubspotInfluencerType: "Male"`, `enrichment.contentLanguage: "German"`.
   Assert: output contains `influencer_vertical: "Gaming"`, `influencer_type: "Male"`,
   `language: "German"`.

2. **Returns empty strings when enrichment fields are null**
   Input: channel with `enrichment.hubspotVertical: null`.
   Assert: `influencer_vertical === ""`.

3. **Does not include brand safety properties**
   Assert: output does not have keys `brand_safety_status` or `brand_safety_flags`.

### Session 5 verification

```bash
pnpm --filter @scouting-platform/core typecheck
pnpm --filter @scouting-platform/core exec vitest run src/hubspot
```

---

## Post-Implementation Verification

After all five sessions are complete:

1. Run the full backend type check:
   ```bash
   pnpm --filter @scouting-platform/core typecheck
   pnpm --filter @scouting-platform/integrations typecheck
   pnpm --filter @scouting-platform/contracts typecheck
   pnpm --filter @scouting-platform/db typecheck
   ```

2. Run all affected test suites:
   ```bash
   pnpm --filter @scouting-platform/core exec vitest run src/hubspot
   pnpm --filter @scouting-platform/integrations exec vitest run src/openai/channel-enrichment.test.ts
   pnpm --filter @scouting-platform/db exec vitest run src/migrations.test.ts
   ```

3. Run the database migration:
   ```bash
   pnpm db:migrate:test
   ```

---

## What This Plan Does NOT Cover

These are explicitly out of scope and deferred to follow-up work:

- **Syncing platform dropdown values with HubSpot** — The platform's `influencerVertical`
  dropdown (5 values) and `influencerType` dropdown (different taxonomy) are not changed.
  The enrichment writes HubSpot-native values directly. Platform dropdowns remain for the
  HubSpot CSV import/preparation workflow which is a separate path.
- **HubSpot CSV import alignment** — The `hubspot-import-batches` path that generates CSVs
  with headers like "Influencer Type" and "Influencer Vertical" uses the platform's dropdown
  values, not the enrichment-derived values. Aligning these is a separate decision.
- **Frontend display of new enrichment fields** — No UI changes for displaying `hubspotVertical`,
  `contentLanguage`, or `brandSafetyStatus` in the catalog or channel detail pages.
- **Re-enrichment of existing channels** — Existing channels with COMPLETED enrichment will
  not have the new fields populated until they are re-enriched (manually or via staleness).
- **Multi-vertical support** — HubSpot's `influencer_vertical` is a single-select enumeration.
  If multi-vertical is needed, this requires a HubSpot property change first.
- **Audience demographics push** — `ChannelInsight` audience data (countries, gender/age,
  interests from HypeAuditor) is not pushed to HubSpot in this plan.
- **Brand safety as a HubSpot property** — If a custom `brand_safety` property is needed in
  HubSpot, it must be created in HubSpot first, then this plan extended.
