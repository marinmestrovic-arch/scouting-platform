# Codex Implementation Guide: HubSpot Push Alignment

- Status: Not Started
- Date: 2026-04-14
- Owner: Ivan

---

## Context

An audit of the HubSpot integration revealed three problems:

1. **The HubSpot push is broken.** `buildHubspotContactProperties()` writes to 10 property names
   (`channel_id`, `youtube_channel_id`, `creator_title`, `creator_handle`, `subscriber_count`,
   `view_count`, `video_count`, `enrichment_summary`, `enrichment_topics`, `brand_fit_notes`)
   that do not exist in HubSpot. HubSpot silently ignores unknown properties in PATCH requests,
   so the push appears to succeed but writes nothing useful.

2. **Computed metrics are not pushed.** The platform already derives `youtubeAverageViews`,
   `youtubeEngagementRate`, and `youtubeFollowers` in `ChannelMetric`, but none of these reach
   HubSpot. HubSpot has matching numeric properties (`youtube_video_average_views`,
   `youtube_engagement_rate`, `youtube_followers`) waiting to be populated.

3. **Creator-level facts derivable from YouTube API are not extracted.** The YouTube channels
   API returns `defaultLanguage` in the snippet, but the platform does not parse or store it.
   HubSpot has a `language` enumeration with 40+ values that could be populated.

### Design decision: No LLM enrichment changes

The OpenAI enrichment (`summary`, `topics`, `brandFitNotes`, `confidence`) is doing the right
job — synthesizing channel data into a human-readable evaluation for the scout. It should NOT be
expanded to classify creators into HubSpot's dropdown taxonomies because:

- **Classification is already handled.** The HubSpot preparation workflow lets the user set
  `influencerVertical`, `influencerType`, `language`, and `countryRegion` as run-level defaults
  with per-row overrides. This happens with campaign context, which the LLM does not have.
- **LLM classification into rigid enums is unreliable.** A "PC builds and gaming" creator is
  Gaming for one campaign and Tech for another. The user knows; the LLM guesses.
- **Coupling enrichment to HubSpot's taxonomy creates maintenance debt.** If HubSpot's enum
  options change, the prompt constants break.

Instead, this plan derives what can be derived deterministically (size tier from subscriber count,
language from YouTube API, best-effort vertical from enrichment topics) and leaves the rest to
the human classification step that already exists.

### HubSpot Properties (Reference)

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
- `language` — English (US), English (UK), Spanish, French, German, Italian, Portuguese, Dutch,
  Swedish, Danish, Norwegian, Finnish, Polish, Czech, Slovak, Hungarian, Romanian, Bulgarian,
  Croatian, Serbian, Slovenian, Albanian, Greek, Ukrainian, Russian, Turkish, Arabic, Hebrew,
  Hindi, Bengali, Tamil, Telugu, Marathi, Urdu, Indonesian, Malay, Thai, Vietnamese, Filipino,
  Chinese, Japanese, Korean
- `platforms` — YouTube, Instagram, TikTok, Twitter, Twitch, Kick
- `contact_type` — Influencer, Agent, Client, Partner

**Numeric fields:**

- `youtube_followers`, `youtube_video_average_views`, `youtube_video_median_views`,
  `youtube_engagement_rate`, `youtube_shorts_average_views`, `youtube_shorts_median_views`

**Text fields:**

- `youtube_url`, `youtube_handle`, `influencer_url`

---

## Constraints

- ADR-002 precedence rules unchanged
- No OpenAI prompt or output schema changes
- No new queue families or worker processes
- No frontend changes
- Enrichment fields (`summary`, `topics`, `brandFitNotes`, `confidence`) untouched
- HubSpot preparation workflow (import batch path) untouched

---

## Delivery Shape

Four sessions, executed in order. Each is self-contained and testable.

| Session | Scope | Schema change? |
|---------|-------|----------------|
| 1 | Fix property mapping + push metrics | No |
| 2 | Influencer size tier utility | No |
| 3 | Extract language from YouTube API, store on channel, push | Yes — one column |
| 4 | Best-effort topic→vertical mapping at push time | No |

---

## Session 1 — Fix HubSpot Property Mapping

**Scope:** Rewrite `buildHubspotContactProperties()` to push to property names that actually
exist in HubSpot. Push YouTube metrics already computed in `ChannelMetric`. No schema changes.

### 1A. Update the channel push select

File: `backend/packages/core/src/hubspot/index.ts`

Expand `channelPushSelect` to include the metric fields needed for the new mapping:

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

Replace the current function body. The new function maps to property names that exist in HubSpot:

```typescript
export function buildHubspotContactProperties(channel: PushChannelRecord): Record<string, string> {
  const subscriberCount = channel.metrics?.subscriberCount;

  return {
    email: channel.contacts[0]?.email ?? "",
    contact_type: "Influencer",
    platforms: "YouTube",
    youtube_url: channel.youtubeUrl
      ?? `https://www.youtube.com/channel/${channel.youtubeChannelId}`,
    youtube_handle: channel.handle ?? "",
    influencer_url: channel.youtubeUrl
      ?? `https://www.youtube.com/channel/${channel.youtubeChannelId}`,
    youtube_followers: channel.metrics?.youtubeFollowers?.toString()
      ?? subscriberCount?.toString()
      ?? "",
    youtube_video_average_views: channel.metrics?.youtubeAverageViews?.toString() ?? "",
    youtube_engagement_rate: channel.metrics?.youtubeEngagementRate?.toString() ?? "",
    influencer_size: computeInfluencerSizeTier(subscriberCount),
  };
}
```

For Session 1, add `computeInfluencerSizeTier` as an inline function above
`buildHubspotContactProperties`:

```typescript
function computeInfluencerSizeTier(subscriberCount: bigint | null | undefined): string {
  if (subscriberCount === null || subscriberCount === undefined) return "";
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

The tier labels **must** exactly match the HubSpot `influencer_size` enum values listed above.

### 1C. Tests

File: `backend/packages/core/src/hubspot/index.test.ts` (create if it does not exist)

Test `buildHubspotContactProperties`:

1. **Maps YouTube metrics to correct HubSpot property names**
   Input: channel with `youtubeUrl: "https://youtube.com/@test"`, `handle: "@test"`,
   `youtubeFollowers: 150000n`, `youtubeAverageViews: 25000n`, `youtubeEngagementRate: 3.5`.
   Assert: output contains `youtube_url`, `youtube_handle`, `youtube_followers: "150000"`,
   `youtube_video_average_views: "25000"`, `youtube_engagement_rate: "3.5"`.

2. **Sets contact_type and platforms**
   Assert: `contact_type === "Influencer"`, `platforms === "YouTube"`.

3. **Falls back to channel ID URL when youtubeUrl is null**
   Input: `youtubeUrl: null`, `youtubeChannelId: "UCxyz"`.
   Assert: `youtube_url` and `influencer_url` both equal
   `"https://www.youtube.com/channel/UCxyz"`.

4. **Returns empty strings for missing metrics**
   Input: `metrics: null`.
   Assert: `youtube_followers`, `youtube_video_average_views`, `youtube_engagement_rate` are
   all `""`.

5. **Computes influencer_size tier correctly**
   Test each boundary: 500 → `""`, 1000 → `"Nano (1K - 5K)"`, 5000 → `"Micro (5K - 20K)"`,
   20000 → `"Mid-tier (20K - 100K)"`, 100000 → `"Macro (100K - 500K)"`,
   500000 → `"Mega (500K - 1M)"`, 1000000 → `"Macro-tier (1M+)"`.

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

## Session 2 — Influencer Size Tier as Shared Utility

**Scope:** Extract `computeInfluencerSizeTier` into its own file for independent testing and
reuse.

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
  if (subscriberCount === null || subscriberCount === undefined) return "";
  const count = Number(subscriberCount);
  if (!Number.isFinite(count) || count < 0) return "";
  for (const tier of INFLUENCER_SIZE_TIERS) {
    if (count >= tier.min) return tier.label;
  }
  return "";
}
```

### 2B. Wire into HubSpot push

File: `backend/packages/core/src/hubspot/index.ts`

- Add `import { computeInfluencerSizeTier } from "./influencer-size";`
- Remove the inline `computeInfluencerSizeTier` added in Session 1

### 2C. Tests

File: `backend/packages/core/src/hubspot/influencer-size.test.ts` (new file)

1. **Returns empty for null/undefined** — both return `""`
2. **Returns empty for sub-1K** — `999` returns `""`
3. **Correct tier at each boundary** — 1000, 4999, 5000, 19999, 20000, 99999, 100000, 499999,
   500000, 999999, 1000000, 5000000
4. **Handles bigint** — `BigInt(250000)` returns `"Macro (100K - 500K)"`
5. **Returns empty for negative/NaN/Infinity** — all return `""`

### Session 2 verification

```bash
pnpm --filter @scouting-platform/core typecheck
pnpm --filter @scouting-platform/core exec vitest run src/hubspot
```

---

## Session 3 — Extract Content Language from YouTube API

**Scope:** Parse `defaultLanguage` from the YouTube channels API response (already fetched but
not extracted), store it on the `Channel` record, and push to HubSpot's `language` property.

### 3A. Expand YouTube channel response parsing

File: `backend/packages/integrations/src/youtube/context.ts`

In `channelResponseSchema`, add `defaultLanguage` to the channel snippet:

```typescript
snippet: z.object({
  title: z.string(),
  description: z.string().optional(),
  customUrl: z.string().optional(),
  publishedAt: z.string().optional(),
  defaultLanguage: z.string().optional(),   // ← add this line
  thumbnails: z
    // ... rest unchanged
```

### 3B. Add defaultLanguage to YoutubeChannelContext

File: `backend/packages/integrations/src/youtube/context.ts`

Add to `youtubeChannelContextSchema`:

```typescript
defaultLanguage: z.string().trim().nullable(),
```

Add to `YoutubeChannelContextDraft` type:

```typescript
defaultLanguage: string | null;
```

In `fetchYoutubeChannelContext`, where the channel snippet is mapped to the context draft, add:

```typescript
defaultLanguage: channelSnippet.defaultLanguage?.trim() ?? null,
```

### 3C. BCP-47 to HubSpot language mapping

File: `backend/packages/core/src/hubspot/language-mapping.ts` (new file)

Create a static map from BCP-47 language codes to HubSpot `language` enum values:

```typescript
const BCP47_TO_HUBSPOT_LANGUAGE: Record<string, string> = {
  en: "English (US)",
  "en-us": "English (US)",
  "en-gb": "English (UK)",
  "en-au": "English (UK)",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  nl: "Dutch",
  sv: "Swedish",
  da: "Danish",
  no: "Norwegian",
  nb: "Norwegian",
  nn: "Norwegian",
  fi: "Finnish",
  pl: "Polish",
  cs: "Czech",
  sk: "Slovak",
  hu: "Hungarian",
  ro: "Romanian",
  bg: "Bulgarian",
  hr: "Croatian",
  sr: "Serbian",
  sl: "Slovenian",
  sq: "Albanian",
  el: "Greek",
  uk: "Ukrainian",
  ru: "Russian",
  tr: "Turkish",
  ar: "Arabic",
  he: "Hebrew",
  iw: "Hebrew",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  ur: "Urdu",
  id: "Indonesian",
  ms: "Malay",
  th: "Thai",
  vi: "Vietnamese",
  fil: "Filipino",
  tl: "Filipino",
  zh: "Chinese",
  "zh-cn": "Chinese",
  "zh-tw": "Chinese",
  ja: "Japanese",
  ko: "Korean",
};

export function mapYoutubeLanguageToHubspot(
  bcp47: string | null | undefined,
): string {
  if (!bcp47?.trim()) return "";
  const normalized = bcp47.trim().toLowerCase();
  return BCP47_TO_HUBSPOT_LANGUAGE[normalized]
    ?? BCP47_TO_HUBSPOT_LANGUAGE[normalized.split("-")[0]]
    ?? "";
}
```

### 3D. Prisma schema change

File: `backend/packages/db/prisma/schema.prisma`

Add to the `Channel` model, after `thumbnailUrl`:

```prisma
contentLanguage  String?  @map("content_language")
```

### 3E. Migration file

Create directory and file:
`backend/packages/db/prisma/migrations/20260414120000_channel_content_language/migration.sql`

```sql
ALTER TABLE "channels" ADD COLUMN "content_language" TEXT;
```

### 3F. Write language during enrichment execution

File: `backend/packages/core/src/enrichment/index.ts`

Import the mapping:
```typescript
import { mapYoutubeLanguageToHubspot } from "../hubspot/language-mapping";
```

In `executeChannelLlmEnrichment`, inside the final transaction where the `channel` record is
updated (the `tx.channel.update` call that writes `handle`, `youtubeUrl`, `description`,
`thumbnailUrl`), add:

```typescript
contentLanguage: mapYoutubeLanguageToHubspot(youtubeContext.defaultLanguage),
```

If the mapped value is empty string, write `null` instead:

```typescript
contentLanguage: mapYoutubeLanguageToHubspot(youtubeContext.defaultLanguage) || null,
```

### 3G. Push language to HubSpot

File: `backend/packages/core/src/hubspot/index.ts`

Add `contentLanguage: true` to `channelPushSelect`:

```typescript
const channelPushSelect = {
  // ... existing fields ...
  contentLanguage: true,
  // ...
};
```

Add to `buildHubspotContactProperties` return object:

```typescript
language: channel.contentLanguage ?? "",
```

### 3H. Tests

File: `backend/packages/core/src/hubspot/language-mapping.test.ts` (new file)

1. **Maps common BCP-47 codes** — `"en"` → `"English (US)"`, `"de"` → `"German"`,
   `"hr"` → `"Croatian"`, `"ja"` → `"Japanese"`
2. **Maps regional variants** — `"en-GB"` → `"English (UK)"`, `"zh-TW"` → `"Chinese"`,
   `"pt-BR"` → `"Portuguese"`
3. **Case insensitive** — `"EN"`, `"En"`, `"en"` all return `"English (US)"`
4. **Returns empty for null/undefined/empty** — all return `""`
5. **Returns empty for unknown codes** — `"xx"`, `"klingon"` return `""`
6. **Falls back to base code** — `"fr-CA"` → `"French"` (not in map, but `"fr"` is)

File: `backend/packages/db/src/migrations.test.ts`

Add a test case for `20260414120000_channel_content_language`:
- Assert migration SQL contains `ADD COLUMN "content_language"`

File: `backend/packages/core/src/hubspot/index.test.ts`

Add test case:
- **Pushes content language** — channel with `contentLanguage: "German"` → output has
  `language: "German"`
- **Empty when contentLanguage is null** — output has `language: ""`

### Session 3 verification

```bash
pnpm db:migrate:test
pnpm --filter @scouting-platform/db typecheck
pnpm --filter @scouting-platform/db exec vitest run src/migrations.test.ts
pnpm --filter @scouting-platform/integrations typecheck
pnpm --filter @scouting-platform/core typecheck
pnpm --filter @scouting-platform/core exec vitest run src/hubspot
```

---

## Session 4 — Best-Effort Topic-to-Vertical Mapping

**Scope:** Create a lightweight dictionary that maps common enrichment topic words to HubSpot
`influencer_vertical` enum values. Applied at push time — no storage, no LLM changes. This is
best-effort: it reduces manual classification work for common verticals but does not replace the
HubSpot preparation workflow for precision.

### 4A. Create the mapping

File: `backend/packages/core/src/hubspot/vertical-mapping.ts` (new file)

```typescript
const TOPIC_TO_VERTICAL: ReadonlyArray<{
  keywords: readonly string[];
  vertical: string;
}> = [
  { keywords: ["gaming", "games", "game", "playstation", "xbox", "nintendo", "steam", "esports", "twitch", "fortnite", "valorant", "league of legends"], vertical: "Gaming" },
  { keywords: ["minecraft"], vertical: "Minecraft" },
  { keywords: ["tech", "technology", "gadgets", "software", "hardware", "programming", "coding"], vertical: "Tech" },
  { keywords: ["beauty", "makeup", "skincare", "cosmetics", "hair"], vertical: "Beauty" },
  { keywords: ["fashion", "style", "clothing", "outfits"], vertical: "Fashion" },
  { keywords: ["fitness", "gym", "workout", "exercise", "bodybuilding"], vertical: "Fitness" },
  { keywords: ["food", "cooking", "recipe", "baking", "cuisine", "restaurant"], vertical: "Food" },
  { keywords: ["travel", "traveling", "destination", "backpacking", "tourism"], vertical: "Travel" },
  { keywords: ["music", "musician", "guitar", "singing", "producer", "beats"], vertical: "Music" },
  { keywords: ["education", "learning", "tutorial", "study", "lecture"], vertical: "Education" },
  { keywords: ["science", "physics", "chemistry", "biology", "space", "astronomy"], vertical: "Science" },
  { keywords: ["comedy", "humor", "funny", "sketch", "standup"], vertical: "Humor" },
  { keywords: ["news", "journalism", "current events", "breaking"], vertical: "News" },
  { keywords: ["politics", "political", "government", "election"], vertical: "Politics" },
  { keywords: ["sports", "sport", "football", "basketball", "soccer", "tennis", "athletics"], vertical: "Sport" },
  { keywords: ["art", "drawing", "illustration", "digital art", "painting"], vertical: "Art" },
  { keywords: ["photography", "photo", "camera", "lens"], vertical: "Photography" },
  { keywords: ["film", "cinema", "movie", "movies", "film review"], vertical: "Movies" },
  { keywords: ["anime", "manga", "otaku"], vertical: "Anime" },
  { keywords: ["diy", "crafts", "handmade", "maker"], vertical: "DIY" },
  { keywords: ["pets", "dog", "cat", "animals", "animal"], vertical: "Pets" },
  { keywords: ["vlog", "vlogging", "daily vlog", "day in my life"], vertical: "Vlog" },
  { keywords: ["podcast", "podcasting", "interview"], vertical: "Podcast" },
  { keywords: ["finance", "investing", "stocks", "crypto", "money", "trading"], vertical: "Finance" },
  { keywords: ["health", "wellness", "mental health", "nutrition", "diet"], vertical: "Health" },
  { keywords: ["lifestyle"], vertical: "Lifestyle" },
  { keywords: ["history", "historical", "ancient"], vertical: "History" },
  { keywords: ["cars", "automotive", "car review", "vehicle"], vertical: "Cars" },
  { keywords: ["asmr"], vertical: "ASMR" },
  { keywords: ["outdoor", "hiking", "camping", "nature", "wilderness"], vertical: "Outdoor" },
  { keywords: ["mystery", "true crime", "crime", "unsolved"], vertical: "Mystery" },
  { keywords: ["kids", "children", "family friendly"], vertical: "Kids" },
  { keywords: ["commentary", "opinion", "reaction", "rant"], vertical: "Commentary" },
  { keywords: ["reviews", "review", "unboxing", "product review"], vertical: "Reviews" },
  { keywords: ["entertainment"], vertical: "Entertainment" },
  { keywords: ["motivation", "self improvement", "productivity", "mindset"], vertical: "Motivation" },
  { keywords: ["fishing"], vertical: "Fishing" },
  { keywords: ["hunting"], vertical: "Hunting" },
  { keywords: ["yoga", "meditation"], vertical: "Yoga" },
  { keywords: ["lego", "legos"], vertical: "Lego" },
  { keywords: ["chess"], vertical: "Chess" },
  { keywords: ["cycling", "bike", "biking"], vertical: "Cycling" },
  { keywords: ["dance", "dancing", "choreography"], vertical: "Dance" },
  { keywords: ["documentary"], vertical: "Documentary" },
  { keywords: ["engineering", "engineer"], vertical: "Engineering" },
  { keywords: ["construction", "building"], vertical: "Construction" },
  { keywords: ["guitar", "guitars", "bass guitar"], vertical: "Guitars" },
  { keywords: ["plants", "gardening", "garden"], vertical: "Plants" },
  { keywords: ["parenting", "parent", "mom", "dad"], vertical: "Parenting" },
  { keywords: ["cosplay"], vertical: "Cosplay" },
  { keywords: ["astrology", "horoscope", "zodiac"], vertical: "Astrology" },
  { keywords: ["conspiracy", "conspiracies"], vertical: "Conspiracy" },
];

export function inferVerticalFromTopics(
  topics: unknown,
): string {
  if (!Array.isArray(topics)) return "";

  const normalized = topics
    .filter((topic): topic is string => typeof topic === "string")
    .map((topic) => topic.toLowerCase().trim());

  if (normalized.length === 0) return "";

  for (const mapping of TOPIC_TO_VERTICAL) {
    for (const keyword of mapping.keywords) {
      if (normalized.some((topic) => topic === keyword || topic.includes(keyword))) {
        return mapping.vertical;
      }
    }
  }

  return "";
}
```

The array is ordered by rough frequency / likelihood. The first match wins. This is intentional:
a creator with topics `["gaming", "tech"]` maps to Gaming, which is the more specific vertical.

### 4B. Wire into HubSpot push

File: `backend/packages/core/src/hubspot/index.ts`

Import the mapping:
```typescript
import { inferVerticalFromTopics } from "./vertical-mapping";
```

Add to `buildHubspotContactProperties` return object:

```typescript
influencer_vertical: inferVerticalFromTopics(channel.enrichment?.topics),
```

### 4C. Tests

File: `backend/packages/core/src/hubspot/vertical-mapping.test.ts` (new file)

1. **Maps common topics** — `["gaming", "pc"]` → `"Gaming"`,
   `["beauty", "skincare"]` → `"Beauty"`, `["tech", "reviews"]` → `"Tech"`
2. **Case insensitive** — `["GAMING"]` → `"Gaming"`, `["Beauty"]` → `"Beauty"`
3. **Partial match** — `["pc gaming"]` → `"Gaming"` (contains "gaming")
4. **First match wins** — `["gaming", "tech"]` → `"Gaming"` (gaming rule is first)
5. **Returns empty for no match** — `["obscure niche"]` → `""`
6. **Returns empty for null/empty/non-array** — `null`, `[]`, `"not an array"` → `""`
7. **Minecraft maps to Minecraft, not Gaming** — `["minecraft"]` → `"Minecraft"`

File: `backend/packages/core/src/hubspot/index.test.ts`

Add test case:
- **Pushes inferred vertical from topics** — channel with `enrichment.topics: ["gaming", "fps"]`
  → output has `influencer_vertical: "Gaming"`
- **Empty vertical when topics don't match** — `enrichment.topics: ["something random"]`
  → `influencer_vertical: ""`
- **Empty vertical when no enrichment** — `enrichment: null`
  → `influencer_vertical: ""`

### Session 4 verification

```bash
pnpm --filter @scouting-platform/core typecheck
pnpm --filter @scouting-platform/core exec vitest run src/hubspot
```

---

## Post-Implementation Verification

After all four sessions are complete:

1. Full backend type check:
   ```bash
   pnpm --filter @scouting-platform/core typecheck
   pnpm --filter @scouting-platform/integrations typecheck
   pnpm --filter @scouting-platform/db typecheck
   ```

2. All affected test suites:
   ```bash
   pnpm --filter @scouting-platform/core exec vitest run src/hubspot
   pnpm --filter @scouting-platform/db exec vitest run src/migrations.test.ts
   ```

3. Database migration:
   ```bash
   pnpm db:migrate:test
   ```

---

## What This Plan Does NOT Cover

Explicitly out of scope:

- **LLM enrichment changes** — No prompt, schema, or output changes to the OpenAI integration.
  The enrichment is doing the right job as a human evaluation tool.
- **HubSpot `influencer_type` auto-classification** — Requires visual/content analysis the LLM
  cannot reliably do from text. Set manually during HubSpot preparation.
- **HubSpot CSV import alignment** — The import batch path uses platform dropdown values set
  during preparation. This is the right approach and is unchanged.
- **Platform dropdown taxonomy sync** — The platform's `influencerVertical` (5 values) and
  HubSpot's (70+) serve different purposes. Platform dropdowns are for the preparation workflow.
  HubSpot properties are populated by the push. No alignment needed now.
- **Frontend changes** — No UI changes for language or vertical display.
- **Audience demographics push** — HypeAuditor audience data is not pushed in this plan.
- **Campaign-aware enrichment** — A future direction where the LLM evaluates a creator
  specifically for a campaign brief (fit score, talking points, concerns). This would live on
  `RunResult` as a per-channel-per-campaign assessment, not on the channel enrichment.

## What Should Change Next (After This Plan)

The highest-value follow-on is **campaign-aware enrichment**: instead of the generic "tell me
about this creator" enrichment, evaluate creators against a specific campaign brief. Input is
channel context + campaign brief (client, product, audience, requirements). Output is a fit
score and specific reasons. This is where the LLM adds genuine value beyond what deterministic
derivation can do. It would live on `RunResult` (per-channel-per-run) rather than
`ChannelEnrichment` (per-channel).
