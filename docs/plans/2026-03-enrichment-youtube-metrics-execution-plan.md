# Execution Plan: Enrichment Extensions and YouTube Raw Metrics

- Status: Draft
- Date: 2026-03-09
- Owner: Ivan

---

# Purpose

This document defines a safe implementation plan for:

- extending the existing structured LLM enrichment output
- expanding cached YouTube context for recent-video analysis
- deriving precedence-safe YouTube raw metrics into canonical storage

This plan preserves the current system shape and does not replace any existing governance document.

---

# Scope Constraint

This plan is backend-only.

It is limited to Ivan-owned backend work in:

- `packages/core`
- `packages/integrations`
- `packages/db`
- `packages/contracts`
- worker execution
- additive server/API response changes where required for backend delivery

It does not include:

- new frontend screens
- frontend UX changes
- Playwright coverage
- design-system work
- UI changes that require Marin to rework or pause Week 6 catch-up work

---

# Current Repo Baseline

The current backend already has:

- cached YouTube channel context
- worker-owned `channels.enrich.llm` execution
- structured LLM enrichment persisted as:
  - `summary`
  - `topics`
  - `brandFitNotes`
  - `confidence`
- canonical metric storage in `channel_metrics`
- source-aware metric precedence fields on `channel_metrics`
- Week 6 backend delivery for:
  - CSV export batches
  - HubSpot push batches
  - related worker execution, audits, and integration coverage

This plan therefore **extends the current enrichment model**. It does not introduce structured enrichment from scratch.

---

# Relationship to Backlog

`/TASKS.md` remains authoritative.

Week 6 backend work is complete on Ivan's side. Week 6 still has open UI work on Marin's side.

Because of that, this document should be treated as:

- an intentional backend-forward follow-up while frontend Week 6 work catches up, or
- a founder-approved reprioritization if Week 7 stabilization must take precedence instead

This plan must not be treated as a hidden scope change for Week 6. It is a separate additive backend slice.

---

# Architectural Guardrails

All work described here must remain consistent with the existing rules:

- catalog remains canonical
- runs remain snapshots
- worker stays separate from web
- provider calls remain server-side only
- Prisma migrations remain the only schema change mechanism
- no new major subsystem
- no new enrichment queue family in this slice
- manual admin edits and CSV imports must continue to outrank automated sources

No change in this document should require a new ADR.

---

# Delivery Shape

This work should be implemented as **three separate PRs**, matching the three batches below.

That split is intentional for safety:

- each PR stays reviewable and migration scope remains bounded
- rollback risk is lower if one batch causes integration issues
- Batch 3 depends directly on the richer cached YouTube context from Batch 2
- frontend work stays unblocked because each PR is backend-complete on its own surface

Recommended PR order:

1. PR 1: structured enrichment extension only
2. PR 2: expanded cached YouTube context only
3. PR 3: precedence-safe YouTube raw metrics only

Do not combine all three batches into one PR unless there is a strong schedule reason and both
founders explicitly prefer the larger review surface.

---

# Non-Goals

The following are out of scope for this plan:

- campaign scoring
- new queue/job families for enrichment stages
- discovery redesign
- UI redesign
- frontend implementation for new enrichment or metric fields
- admin or catalog UI changes for this slice
- any UI dependency that blocks Marin's Week 6 catch-up work
- YouTube Analytics or Reporting APIs
- comment sentiment or moderation pipelines
- export schema decisions
- manual override UI for new enrichment-only fields

---

# Execution Sequence

## Batch 1: Extend Existing Structured LLM Enrichment

### Goal

Extend the existing Week 4 structured enrichment output instead of replacing it.

### Data Shape

Keep the current fields:

- `summary`
- `topics`
- `brandFitNotes`
- `confidence`

Add one new additive structured object on `channel_enrichments`, for example `structuredProfile`, that contains the richer machine-readable fields.

Recommended shape:

```json
{
  "metadata": {
    "language": "de",
    "contentFormats": ["long_form"],
    "sponsorSignals": ["raid shadow legends"],
    "geoHints": ["DACH"],
    "uploadCadenceHint": "weekly"
  },
  "niche": {
    "primary": "true_crime",
    "secondary": ["mystery"],
    "confidence": 0.84
  },
  "brandSafety": {
    "status": "caution",
    "flags": ["violence"],
    "rationale": "Frequent violent crime subject matter",
    "confidence": 0.78
  }
}
```

### Rules

- existing `summary/topics/brandFitNotes/confidence` remain persisted and exposed
- new structured fields are additive only
- new structured fields are enrichment-only metadata, not authoritative catalog fields
- no manual override support is added in this slice
- no list API changes in this slice
- if the channel detail contract changes, it must be additive on `GET /api/channels/:id`

### Execution Notes

- update the OpenAI prompt and response schema together
- validate the full structured response with zod
- persist both:
  - compatibility fields (`summary/topics/brandFitNotes/confidence`)
  - the new structured object
- keep `channels.enrich.llm` as the only enrichment job

### Done When

- LLM enrichment remains worker-owned and queue topology stays unchanged
- current enrichment fields still work unchanged
- richer structured output is validated and persisted
- channel detail can expose the additive structured object
- parsing, persistence, and API tests cover the new shape

---

## Batch 2: Expand Cached YouTube Context for Recent Videos

### Goal

Extend cached YouTube context so it contains enough normalized recent-video data to support both stronger enrichment and deterministic metric derivation.

### Fetch Strategy

Use the uploads playlist and inspect recent uploads until one of these is true:

- 12 long-form videos have been identified, or
- 50 recent uploads have been inspected

This avoids the current mismatch where a 12-video long-form metric is impossible if only a small recent-upload window is fetched.

### Provider Calls

- keep YouTube provider parsing in `packages/integrations`
- use `playlistItems.list` to gather upload video IDs
- use `videos.list` for those IDs to fetch normalized metadata
- batch IDs efficiently and remain quota-conscious

### Normalized Recent Video Fields

Each cached recent video should include:

- `youtubeVideoId`
- `publishedAt`
- `durationSeconds`
- `isShort`
- `viewCount`
- `likeCount`
- `commentCount`
- `categoryId`
- `tags`

### Shorts Rule

Shorts classification must be deterministic and centralized.

For this slice:

- `isShort = durationSeconds <= 180`
- `isLongForm = durationSeconds > 180`

Use one shared helper in `packages/core` so enrichment and metric derivation use the same rule.

### Done When

- cached YouTube context stores normalized recent-video fields
- the fetch window supports the later 12-long-form metric rule
- parsing and caching tests cover the new fields
- Shorts classification is shared and deterministic

---

## Batch 3: Persist Precedence-Safe YouTube Raw Metrics

### Goal

Populate deterministic YouTube raw metrics in canonical storage without violating the existing source precedence rules.

### Metrics in Scope

Required:

- `subscriberCount`
- `averageViews`

Optional if trivial:

- `averageLikes`

`averageLikes` is optional only as a delivery-size constraint, not because it is lower-quality data.
If it can be added without materially widening the migration, merge logic, and test surface for PR
3, it is reasonable to include it in the same batch.

If it noticeably expands the PR, defer it to a follow-up rather than delaying the required raw
metric work.

### Field Governance Model

This implementation should use field governance to keep data ownership sane without changing the
repo's global precedence rules.

#### YouTube-only factual fields

These are direct platform facts or deterministic derivatives of YouTube raw data.

Examples:

- `subscriberCount`
- `viewCount`
- `videoCount`
- `averageViews`
- `averageLikes`
- upload-derived cadence/counts
- cached recent-video stats such as `viewCount`, `likeCount`, and `commentCount`

Rules:

- `LLM` must not write these fields
- `HypeAuditor` must not overwrite these fields in this slice
- `YouTube raw` is the primary automated source for these factual fields
- these fields still obey the repo's fixed global precedence order when a higher-ranked source
  already owns the field

#### HypeAuditor-owned audience/commercial fields

These are audience/commercial enrichment fields already aligned with the Week 5 model.

Examples:

- audience geography
- audience gender/age
- audience interests
- estimated price
- brand mentions

Rules:

- `YouTube raw` does not populate these fields
- `LLM` may populate provisional values for these fields where that is already part of the
  enrichment design
- `HypeAuditor` overwrites `LLM` values for these fields when present
- `LLM` may still reference these fields in narrative output, but should not own factual platform
  metrics

#### LLM-only interpretive fields

These remain descriptive and inferential only.

Examples:

- `summary`
- `topics`
- `brandFitNotes`
- `structuredProfile`
  - niche
  - sponsor signals
  - geo hints
  - brand safety rationale
  - content-format interpretation

Rules:

- no factual platform metrics belong here
- these fields remain additive enrichment metadata, not canonical raw facts

#### Heuristics

Heuristics remain below `LLM` and above `YouTube raw` under the current repo-wide precedence
model.

In practice, heuristics should stay narrow and deterministic.

Examples:

- contact extraction signals
- lightweight metadata hints
- simple text-derived support signals where already justified

Rules:

- heuristics should not own factual platform metrics
- heuristics should not replace HypeAuditor-owned audience/commercial fields when HypeAuditor or
  LLM already owns them

#### Admin/CSV override layer

For this plan, the top override layer remains unchanged:

- `admin_manual`
- `csv_import`

Both continue to outrank automated sources under the current locked precedence rules.

### Separate Precedence Decision

The idea that "only manual edits should override, not CSV" is **not** part of this implementation
plan.

That would be a separate precedence-change decision because the current repo rules explicitly place
`csv_import` above `HypeAuditor`, `LLM`, `heuristics`, and `YouTube raw`.

This plan must therefore preserve the current global precedence order:

1. admin manual edit
2. admin CSV import
3. HypeAuditor
4. LLM
5. heuristics
6. YouTube raw

Good follow-on metrics after the initial slice:

- `averageComments`
- `channelViewCount`
- `videoCount`
- `uploadCadence`
- `recentLongFormCount`
- `recentShortCount`

Metrics are stored in `channel_metrics`.

### Average Rule

Use the most recent 12 long-form videos from the inspected recent-upload window.

Definitions:

- exclude any video where `isShort = true`
- if fewer than 12 long-form videos exist in the inspected window, average the available long-form videos
- if no long-form videos exist, the derived metric remains `null`

### Source and Precedence Rules

All metrics derived in this batch are `YOUTUBE_RAW`.

Field ownership for this slice is:

- `YOUTUBE_RAW` is the primary automated source for factual observable performance metrics
- `LLM` is not used as a source for factual metrics such as `subscriberCount`, `averageViews`, `averageLikes`, `averageComments`, `channelViewCount`, or `videoCount`
- `LLM` remains limited to interpretive fields such as summary, topics, niche hints, brand-fit observations, language hints, and brand-safety metadata
- `HypeAuditor` remains the higher-precedence source for audience/commercial fields when present

For each metric field:

- if current source is `null`, write the YouTube-derived value and mark source `YOUTUBE_RAW`
- if current source is already `YOUTUBE_RAW`, update the value and timestamp
- if current source is `CSV_IMPORT`, `HYPEAUDITOR`, `ADMIN_MANUAL`, `LLM`, or `HEURISTICS`, do not overwrite it
- if the new YouTube-derived value is `null`, do not clear a higher-precedence existing value

This preserves ADR-002 precedence and keeps CSV-imported metrics authoritative over YouTube raw.

### Execution Hook

Do not add a new queue family.

For the initial slice, derive and persist YouTube raw metrics inside the existing `channels.enrich.llm` execution after YouTube context refresh succeeds.

Reason:

- metric derivation depends on refreshed YouTube context
- deterministic provider metrics should still update even if the later OpenAI call fails

This means YouTube raw metrics may update even when enrichment status ends as `failed`.

### Provenance Decision

Do not add a separate provenance table in this slice.

The expanded cached YouTube context from Batch 2 is the minimal raw explanation surface for the initial implementation.

If full reproducibility or longer retention is needed later, that is a separate follow-up.

### Done When

- `subscriberCount` can be populated as `YOUTUBE_RAW` when no higher-precedence source exists
- `averageViews` is derived centrally from recent long-form videos
- `averageLikes` is added only if it does not materially expand the PR
- CSV-imported metrics remain untouched
- tests cover merge behavior, null behavior, and long-form averaging

---

# Test Requirements

At minimum, cover:

- OpenAI structured response parsing and persistence
- additive channel detail contract behavior
- recent-video parsing and cache persistence
- Shorts classification helper behavior
- averaging from:
  - 12+ long-form videos
  - fewer than 12 long-form videos
  - zero long-form videos
- precedence protection where `CSV_IMPORT` or another higher source already owns the metric
- successful metric updates when YouTube context refresh succeeds but OpenAI fails later

---

# Deferred Until Later

These are explicitly deferred:

- manual overrides for new enrichment-only fields such as niche, language, and brand safety
- durable separate storage for normalized YouTube video snapshots beyond cached context
- campaign scoring
- discovery ranking changes
- export-field mapping decisions based on new enrichment fields

---

# Suggested PR Batching

Keep the work reviewable:

### PR 1

Extend the existing structured LLM enrichment output additively.

### PR 2

Expand cached YouTube context and add the shared Shorts helper.

### PR 3

Persist precedence-safe YouTube raw metrics using the existing enrichment worker path.

---

# Summary

This plan is safe if treated as an extension of the current Week 4 enrichment foundation rather than a rewrite.

Its critical constraints are:

- do not destabilize completed Week 6 backend behavior while frontend Week 6 work is still catching up
- do not overwrite higher-precedence metric sources
- do not define a 12-video metric using an insufficient fetch window

If those three constraints are kept explicit, the plan stays aligned with the repo’s current architecture and precedence model.
