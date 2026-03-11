# Execution Plan: Provider Spend Hardening

- Status: Draft
- Date: 2026-03-11
- Owner: Ivan

---

# Purpose

This document defines a backend-only hardening slice to reduce avoidable provider spend across:

- HypeAuditor advanced reports
- OpenAI channel enrichment
- YouTube run discovery
- YouTube enrichment context refresh
- provider spend telemetry

The goal is to remove duplicate or unnecessary provider calls without changing user-visible product
behavior, freshness windows, approval rules, queue family names, or worker/web boundaries.

---

# Scope Constraint

This plan is limited to Ivan-owned backend work in:

- `packages/core`
- `packages/integrations`
- `packages/db`
- `packages/contracts`
- `apps/worker`

It does not include:

- new user-facing product behavior
- new frontend UX
- approval-policy changes
- freshness-window changes
- worker/web topology changes
- new queue families
- browser-direct provider calls
- new major subsystems

---

# Current Repo Baseline

The current backend already provides part of the required foundation:

- `packages/core/src/enrichment/index.ts`
  - claims `channel_enrichments` rows and persists `rawOpenaiPayload`
  - reuses fresh cached YouTube context
  - does not separate provider-response persistence from normalized enrichment writes
- `packages/core/src/approvals/index.ts`
  - claims `advanced_report_requests`
  - persists a `channel_provider_payloads` row and links it through `providerPayloadId`
  - does not reuse an existing payload on retry before re-calling HypeAuditor
- `packages/core/src/runs/repository.ts`
  - discovery execution is idempotent at the run level
  - no discovery reuse/cache exists across repeated similar runs
- `packages/db/prisma/schema.prisma`
  - already has `channel_enrichments.rawOpenaiPayload`
  - already has `advanced_report_requests.providerPayloadId`
  - does not currently track provider-attempt timestamps, cooldowns, execution phases, or discovery cache state

This means the spend-hardening work is an additive reliability pass over existing flows, not a new
architecture.

---

# Relationship to Backlog

`/TASKS.md` remains authoritative.

This plan should be treated as an additive backend hardening slice after the delivered Week 3-6
backend foundations. It should not be treated as a user-visible scope expansion.

If this work displaces Week 7 stabilization, that reprioritization should be explicit in founder
coordination, but no ADR is required because system shape, queueing approach, and precedence rules
remain unchanged.

---

# Architectural Guardrails

All work in this document must preserve the existing constraints:

- Postgres only
- Prisma migrations only
- worker remains separate from web
- `pg-boss` remains the job system
- browser never calls YouTube, OpenAI, HypeAuditor, or HubSpot directly
- manual admin overrides and CSV imports keep existing precedence over automated sources
- every privileged action stays audited
- every async workflow keeps persisted status and last error

No change in this document should require an ADR.

---

# Success Criteria

This slice is successful when the backend can answer:

- how many provider executions were fresh vs reused
- how many retries reached each provider
- whether a retry after raw-payload persistence avoided a second paid provider call
- average OpenAI token usage per enrichment after payload slimming
- whether repeated runs inside a short TTL reused prior YouTube discovery

And when the existing user-facing flows still behave the same from the UI perspective.

---

# ROI Order

1. HypeAuditor retry hardening and payload reuse
2. OpenAI execution idempotency after provider success
3. OpenAI prompt and payload slimming
4. YouTube discovery reuse for repeated runs
5. Provider spend telemetry and operator visibility

YouTube enrichment-context retry hardening should be shipped alongside the OpenAI execution changes
because the same execution split makes both cheaper.

---

# Execution Sequence

## Batch 1: HypeAuditor Retry Hardening

### Goal

Prevent duplicate HypeAuditor spend on retries after provider success, partial persistence
failures, and `HYPEAUDITOR_REPORT_NOT_READY` retry loops.

### Current Gap

`executeAdvancedReportRequest` always calls `fetchHypeAuditorChannelInsights` after the row is
claimed. If the provider returned data but the transaction fails before `providerPayloadId` is
saved, the next retry reaches HypeAuditor again.

### Planned Changes

- add request-local execution metadata to `advanced_report_requests`, likely:
  - `lastProviderAttemptAt`
  - `nextProviderAttemptAt`
  - `providerFetchedAt`
  - `providerExecutionState` or equivalent explicit markers
- before calling HypeAuditor, reload the request and reuse the linked payload when
  `providerPayloadId` already exists
- split execution into phases:
  1. claim request
  2. fetch provider data once
  3. persist raw payload and payload link first
  4. derive normalized insights from persisted payload
  5. mark request completed
- treat `HYPEAUDITOR_REPORT_NOT_READY` as controlled retry state
- add a small request-local cooldown so queue retries do not immediately hammer the provider

### Data Rules

- keep `advanced_report_requests` as the operator-facing lifecycle row
- keep `channel_provider_payloads` as the raw source snapshot table
- do not change the 120-day freshness rule
- do not change approval semantics
- do not change insight precedence

### Expected Impact

- highest ROI in this slice
- biggest value if the upstream semantics charge per initiation or penalize aggressive retries

### Done When

- a retry after payload persistence does not call HypeAuditor again
- a retry after insight-merge failure reuses persisted raw payload
- `REPORT_NOT_READY` retries respect cooldown and avoid immediate repeated provider attempts
- request status and `lastError` stay visible to operators

---

## Batch 2: OpenAI Execution Idempotency

### Goal

Prevent repeated OpenAI calls when the model already returned a valid response for the current
enrichment attempt.

### Current Gap

`executeChannelLlmEnrichment` already persists `rawOpenaiPayload`, but it does so in the same final
write as normalized fields and completion status. A failure after the model call but before the row
update causes the next retry to call OpenAI again.

### Planned Changes

- add explicit execution metadata to `channel_enrichments`, likely:
  - `rawOpenaiPayloadFetchedAt`
  - `lastProviderAttemptAt`
  - `providerExecutionState` or equivalent
- split execution into phases:
  1. claim job
  2. refresh or reuse YouTube context
  3. call OpenAI once
  4. persist raw payload first
  5. parse and persist normalized enrichment fields
  6. mark completed
- on retry, if the current attempt already has a valid raw payload, skip the model call and resume
  from parsing/persistence
- preserve current stale rules and surface statuses

### Adjacent YouTube Context Guardrail

As part of this batch, apply the same retry-aware pattern to cached YouTube context:

- if valid context was already fetched for this attempt, do not force another provider call after a
  downstream DB failure
- do not change the 14-day freshness rule
- do not increase `maxVideos`

### Expected Impact

- very high ROI during transient DB failures or partial-write incidents
- medium value during normal operation, high value during instability

### Done When

- a retry after raw OpenAI payload persistence does not call OpenAI again
- a retry after YouTube-context persistence does not re-fetch context unnecessarily
- current status UX semantics remain intact

---

## Batch 3: OpenAI Prompt and Payload Slimming

### Goal

Lower token spend per successful OpenAI call without changing the enrichment contract.

### Current Gap

`packages/integrations/src/openai/channel-enrichment.ts` currently pretty-prints the full payload
and sends more context than is necessary for the current output shape.

### Planned Changes

- stop pretty-printing JSON in `buildPrompt`
- send a compact structured payload
- cap recent-video input to the minimum useful count for the existing summary/topics/brand-fit
  contract
- omit fields not used by the current schema
- tighten instructions so the completion stays concise
- keep `gpt-5-nano` as the default model
- optionally allow env-based model overrides for later tuning, but keep defaults unchanged

### Expected Impact

- high ROI with low implementation risk
- direct savings on every successful enrichment call

### Done When

- prompt payload is materially smaller
- parsing remains validated by zod
- integration tests preserve current output-contract expectations

---

## Batch 4: YouTube Discovery Reuse

### Goal

Avoid repeated YouTube discovery calls for materially identical run requests inside a short TTL,
while still producing a fresh run snapshot every time.

### Current Gap

`executeRunDiscover` always calls `discoverYoutubeChannels`. There is no reuse layer keyed by query
and assigned user credential context.

### Planned Changes

- add a short-lived server-side discovery cache keyed by normalized:
  - query
  - user YouTube key hash or user id
  - `maxResults`
- prefer DB-backed cache storage over process-local memory because web and worker are separate
  processes and reuse must survive worker restarts to be worthwhile
- reuse cached discovered channel IDs and normalized snippets inside a short TTL, likely 15-60
  minutes
- continue to:
  - upsert catalog rows
  - build a new `run_results` snapshot
  - keep run ownership and status behavior unchanged

### Data Rules

- cache storage is internal and non-canonical
- runs remain snapshots
- catalog remains canonical

### Expected Impact

- medium ROI overall
- higher value for repeated manager retries on the same query

### Done When

- repeated identical runs inside the TTL reuse discovery payloads
- each run still gets its own `run_results` rows
- no UI-facing semantics change

---

## Batch 5: Spend Telemetry

### Goal

Make provider spend and reuse measurable so the hardening work can be verified and tuned.

### Planned Changes

- add structured logs around each provider execution with:
  - provider
  - operation
  - success or failure
  - retry attempt
  - fresh vs reused
  - token usage when available
  - request class or cost class where practical
- use logs first unless an existing operational table is clearly suitable for lightweight
  aggregates
- ensure the emitted fields are sufficient to answer:
  - fresh vs reused counts per provider
  - retries that reached the provider
  - average OpenAI token usage
  - top spend-risk failure modes

### Expected Impact

- no direct savings
- required to prove the savings from the earlier batches

### Done When

- operators can differentiate fresh calls from reuse
- OpenAI token usage is visible in logs when the provider returns it
- logs make the main spend-risk failure paths obvious

---

# Schema Candidates

The likely internal schema additions are:

## `channel_enrichments`

- provider execution marker fields for retry-aware OpenAI reuse
- provider-attempt timestamps
- raw-payload fetched timestamp

## `advanced_report_requests`

- provider execution marker fields
- last-attempt and next-attempt timestamps for cooldown
- explicit linkage semantics for reuse of an existing `providerPayloadId`

## Optional discovery cache table

Recommended if reuse must survive process restarts and remain effective across separate worker/web
processes.

Possible contents:

- normalized cache key
- user credential hash scope
- query
- `maxResults`
- raw normalized discovery payload
- fetched timestamp
- expires timestamp

This table must be internal only and must not become a canonical source of truth.

---

# Testing Plan

Add or update coverage for:

- HypeAuditor retries after raw payload persistence do not call the provider again
- HypeAuditor `REPORT_NOT_READY` respects cooldown behavior
- OpenAI retries after raw payload persistence do not call OpenAI again
- OpenAI prompt builder emits a compact payload and still validates output parsing
- YouTube enrichment retries reuse prior fetched context when valid context already exists
- repeated run creation with identical query inside the discovery TTL reuses cached discovery but
  still creates a fresh run snapshot
- migration coverage for any new execution-state columns or discovery-cache tables
- regression coverage confirming existing Week 3-5 behavior remains unchanged from the user
  perspective

---

# Recommended Delivery Order

1. HypeAuditor retry hardening and cooldown support
2. OpenAI raw-payload-first persistence and retry reuse
3. YouTube-context retry-aware reuse in the same enrichment pass
4. OpenAI prompt slimming
5. DB-backed discovery cache
6. provider spend telemetry

This order front-loads the highest-spend duplicate-call risks before the lower-risk token and quota
optimizations.

---

# Non-Goals

The following stay out of scope for this slice:

- changing freshness windows
- changing approval windows
- changing user-visible statuses
- changing run UX
- changing queue family names
- changing provider ownership rules
- increasing YouTube recent-video fetch size
- new admin dashboards for spend unless logs prove insufficient first
