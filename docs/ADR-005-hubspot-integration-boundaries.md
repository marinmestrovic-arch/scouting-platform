# ADR-005: HubSpot Integration Boundaries

- Status: Proposed
- Date: 2026-07-20

## Context

The platform currently has two outbound HubSpot concepts:

- a legacy contact-only push that updates contacts by email one row at a time; and
- a run-scoped preparation workflow that validates and stores import-ready CSV rows but does not submit them to HubSpot.

Clients, campaigns, and enumeration labels are already synchronized from one HubSpot portal, but the current implementation loses internal option values, uses display labels as API identifiers, contains portal-specific identifiers in source, and can delete local reference records merely because they were absent from one active-record poll. HubSpot object identities are not retained on canonical contact/run relations, so retries cannot safely resume across batches.

The integration must preserve ADR-002: the catalog remains the canonical creator source and automated inbound HubSpot data must not overwrite manual catalog corrections. HubSpot remains authoritative for CRM-side client/campaign references, owners, pipelines, stages, association identifiers, and CRM lifecycle state.

The current official HubSpot API family is `2026-03`. The Imports API supports multi-object UPSERT and associations, but its success response and polling APIs expose an import identifier, state, and error rows rather than a deterministic mapping of every successful row to its CRM record ID. The CRM Object API supports batch upserts in chunks of at most 100, custom unique identifiers, per-input trace identifiers, returned CRM IDs, and partial-success responses. HubSpot also documents that contact upserts by email do not support partial updates.

## Decision

### System-of-record boundaries

- The Scouting Platform catalog is canonical for creators, their resolved social identities, and platform-computed metrics.
- HubSpot is canonical for client and campaign CRM reference objects, portal object IDs, owners, pipelines, stages, association definitions, property option internal values, and CRM-side deal lifecycle changes.
- Run snapshots remain the platform source for a run's outbound intent. HubSpot does not become a second creator catalog.

### Direct run delivery

The canonical outbound workflow is the existing run-preparation workflow upgraded to direct delivery. It creates a durable `HubspotImportBatch`, prepares rows, batch-upserts one contact per local `ChannelContact`, batch-upserts one logical deal per run, persists all returned IDs, creates explicit associations, and exposes resumable status and per-row results.

The primary transport is the CRM Object API plus the Associations API, not the Imports API. This choice gives the platform a deterministic local-to-HubSpot ID mapping before associations and makes partial retry safe. Requests use:

- `atlas_contact_id` as a manually provisioned unique contact property;
- `atlas_run_id` as a manually provisioned unique deal property;
- deterministic chunks of no more than 100 object inputs;
- per-row write trace IDs and parsed partial-success errors; and
- separately discovered, directional association type IDs.

Before adding a label/type to an existing association pair, the adapter reads and carries forward
the pair's existing types so integration writes do not erase manually managed labels.

Absent values are omitted from writes. Empty strings are sent only by an explicit, audited clear operation. Email is an initial matching/reference value, never the durable integration key.

CSV remains an explicit fallback because it is useful during portal-schema outages and staged rollout, but a locally generated CSV is not reported as a completed HubSpot import. Existing legacy push/import history and compatibility endpoints remain available. The legacy write path is no longer exposed in the primary UI, but remains batch-based and checkpointed so a compatibility call does not reintroduce sequential or duplicate-prone writes.

### Durable identity and portal scope

The database stores a token-free `HubspotPortal` record and explicit foreign-key-backed links:

- `HubspotContactLink` links one portal and one `ChannelContact` to a HubSpot contact ID and stable external key.
- `HubspotDealLink` links one portal and one `RunRequest` to a HubSpot deal ID and stable external key.
- existing Client and Campaign HubSpot identities gain a portal relation without introducing a competing polymorphic identity table.

Access tokens and client secrets remain environment-only. Static/private authentication is used for the current single-portal deployment. OAuth is deferred until installation in multiple portals is required.

### Field ownership and conflicts

Platform-owned outbound fields include platform unique identifiers, resolved social handles/URLs, platform metrics, sync state, and values explicitly confirmed in preparation. HubSpot-owned reference fields include CRM IDs, owners, pipelines/stages, association definitions, property option internal values, and client/campaign CRM state.

Email, name, phone, classifications, and any value editable in both systems are shared/conflict-prone. Inbound disagreement on these fields creates a durable `HubspotConflict`; it does not update `Channel`, `ChannelContact`, or an admin manual override. Conflict resolution that changes canonical data must use precedence-safe core services and create an audit event. The first delivery provides safe recording and an admin read-only list; mutation-based resolution remains disabled until each field has an approved precedence-safe resolver.

### References and health

The integration synchronizes and persists portal identity, owner IDs, pipeline/stage IDs, property option labels and internal values, object type IDs, and directional association type IDs. Display labels are UI-only; outbound writes use internal values.

Required unique properties and labels are validated by a read-only admin health check. The application does not create or mutate portal schema automatically. Missing portal configuration is an actionable blocker, not a guessed default.

### Inbound events and reconciliation

HubSpot v3-signed push webhooks are accepted at a public route that preserves the raw request body, validates the externally visible URI and five-minute timestamp window, uses a constant-time comparison, stores a deduplicated safe event, and enqueues processing. The route intentionally does not require an Auth.js session because the HubSpot signature is its authentication boundary.

Standard push-webhook subscriptions are used only for documented contact/deal events. Portal custom-object event support is not inferred. Client/campaign changes are covered by incremental CRM search plus periodic reconciliation. The newer Webhook Journal can cover generic object types, but its client-credentials OAuth model is deferred with the multi-portal/OAuth work.

Inbound handlers are idempotent and timestamp-aware. Contact/deal events update link/mirror state or create conflicts; they never cascade-delete the catalog or overwrite canonical creator fields. Merge and archive events update links/tombstones safely.

Reconciliation persists a per-portal/object high-water mark, processes explicit archived records, periodically performs a full safety reconciliation, and uses local deactivation/tombstones. Absence from one poll is never proof of deletion. Overlapping sync runs are rejected atomically. The daily schedule uses `Europe/Zagreb`.

### Queue topology

The existing `hubspot.import.batch` job becomes a short, resumable state machine. Each invocation performs one bounded phase and re-enqueues itself when another phase is required; it never holds a worker while waiting. The existing object-sync jobs remain. `hubspot.webhook.process` performs asynchronous webhook handling, and `hubspot.health-check` performs read-only provider diagnostics outside the web request path. Every persisted workflow retains status, `startedAt`, `completedAt`, and `lastError`.

### HubSpot UI extension

A deployable HubSpot developer-platform project lives in `/hubspot-app`. This directory is intentionally outside the production web/worker workspaces because HubSpot builds it with its own toolchain. It targets platform version `2026.03`, private distribution with static authentication, and record cards for contacts and deals. A campaign custom-object card is provisioned only after its portal object type is supplied.

Cards fetch platform data only through configured HTTPS endpoints. Those endpoints validate HubSpot v3 signatures and authorize portal/object context server-side. No private access token or app secret is included in extension code. Upload, installation, record-layout placement, and live validation remain explicit portal-side actions.

## Consequences

### Positive

- Retried work cannot recreate already linked contacts or deals.
- Successful rows can be preserved while retryable failures are retried selectively.
- Portal-specific identifiers are discovered and health-checked rather than compiled into source.
- Direct delivery and inbound processing are durable across worker restarts.
- Catalog precedence and manual overrides remain isolated from CRM-side changes.
- CSV remains available for operational fallback without being the primary mental model.

### Tradeoffs

- Portal administrators must provision two unique properties and any desired association labels before enabling direct sync.
- Object upsert and association phases require more application orchestration than one Imports API submission.
- Standard push webhooks do not cover arbitrary portal custom objects; reconciliation remains necessary.
- OAuth and the Webhook Journal are deferred while the deployment remains single-portal.
- The additive Prisma migration requires review by both repository owners before merge.

## Rejected alternatives

### Imports API as the primary transport

Rejected because successful imported rows do not provide a sufficiently direct durable CRM-ID mapping for safe association creation and failed-row-only retry. It remains a documented fallback option if HubSpot later exposes that mapping.

### Email-only contact identity

Rejected because email is shared/editable and email-based contact upsert does not support partial upserts.

### Automatic portal-schema mutation

Rejected because unique properties and association schemas are consequential portal changes. Health checks and provisioning documentation are safer for the current rollout.

### Deleting records absent from a poll

Rejected because pagination defects, partial provider responses, permissions, or transient errors can omit valid records. Explicit archive evidence or verified state is required for local deactivation, and historical relations are preserved.

## Official references

- [CRM Object APIs](https://developers.hubspot.com/docs/api-reference/latest/crm/using-object-apis)
- [Imports API](https://developers.hubspot.com/docs/api-reference/latest/crm/imports/guide)
- [Properties and unique identifiers](https://developers.hubspot.com/docs/api-reference/latest/crm/properties/guide)
- [Associations](https://developers.hubspot.com/docs/api-reference/latest/crm/associations/overview)
- [Association labels](https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associations-schema/guide)
- [Owners](https://developers.hubspot.com/docs/api-reference/latest/crm/owners/guide)
- [Pipelines](https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide)
- [Webhook request validation](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/request-validation)
- [Webhooks](https://developers.hubspot.com/docs/api-reference/latest/webhooks/guide)
- [Webhook Journal](https://developers.hubspot.com/docs/api-reference/latest/webhooks-journal/guide)
- [UI extensions](https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/overview)
