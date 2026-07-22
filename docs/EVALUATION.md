# Scouting Platform - Codebase Evaluation

**Evaluated:** 2026-07-20

This evaluation describes repository evidence, not live provider behavior. HubSpot direct delivery,
webhooks, associations, and the UI extension were not verified against or deployed to a live
HubSpot portal during this implementation.

## What The Repo Currently Implements

The codebase implements:

- the accepted `frontend/` + `backend/` + `shared/` responsibility-based layout;
- a role-based auth boundary plus a separate `userType` persona model;
- campaign-linked scouting runs with stored campaign/outbound metadata;
- the five primary workspace surfaces: Dashboard, New scouting, Catalog, Database, and Admin;
- CSV and Google Sheets handoff workflows; and
- HubSpot V2 direct contact/deal delivery, CSV fallback, portal-aware identity, reference/object
  reconciliation, health/conflicts, signed webhook processing, and a separately deployable UI
  extension scaffold.

## Architecture Snapshot

Runtime components:

- `frontend/web`: Next.js UI and BFF route handlers;
- `backend/worker`: `pg-boss` workers; and
- Postgres: the only durable data store.

Current workspace packages:

- `frontend/web`
- `backend/worker`
- `backend/packages/core`
- `backend/packages/db`
- `backend/packages/integrations`
- `shared/packages/contracts`
- `shared/packages/config`

`hubspot-app/` is deliberately not a pnpm workspace. HubSpot's developer platform builds and
uploads it through an explicit portal-side process.

Key technical anchors:

- [`backend/packages/db/prisma/schema.prisma`](../backend/packages/db/prisma/schema.prisma) defines
  portal identity, durable contact/deal links, references, cursors, webhook events, conflicts, and
  delivery state.
- [`backend/packages/integrations/src/hubspot/config.ts`](../backend/packages/integrations/src/hubspot/config.ts)
  centralizes HubSpot token/config/feature flags and pins API family `2026-03`.
- [`backend/packages/core/src/hubspot/import-batches.ts`](../backend/packages/core/src/hubspot/import-batches.ts)
  owns run-scoped direct/CSV batch creation, idempotency, durable row state, and retry delegation.
- [`backend/packages/core/src/hubspot/object-sync.ts`](../backend/packages/core/src/hubspot/object-sync.ts)
  owns safe client/campaign reconciliation.
- [`backend/packages/core/src/hubspot/webhooks.ts`](../backend/packages/core/src/hubspot/webhooks.ts)
  persists/deduplicates provider events and applies precedence-safe processing.
- [`hubspot-app/README.md`](../hubspot-app/README.md) describes the standalone private/static
  HubSpot UI-extension scaffold.

## Verified Repository Strengths

- Provider HTTP behavior is isolated in `backend/packages/integrations`; browser code does not hold
  the private access token or client secret.
- The preferred credential is now `HUBSPOT_ACCESS_TOKEN`; `HUBSPOT_API_KEY` is retained only as a
  deprecated fallback.
- All V2 feature flags are strict booleans and default off.
- Direct delivery uses stable portal-aware contact/run keys and persists returned HubSpot IDs before
  association work, which provides the state required for restart-safe partial retry.
- Dropdown/reference rows retain both labels and internal HubSpot values instead of using UI labels
  as API identifiers.
- Object synchronization records explicit archived state, cursors, warnings, and overlap leases;
  absence from a single poll is not treated as deletion.
- Webhook events have durable deduplication/status/error fields and move provider work to a worker.
- Inbound shared-field disagreement is recorded as a conflict instead of overwriting catalog/admin
  data.
- Health, conflict, sync, delivery, retry, and provider-authenticated route surfaces use shared
  contracts and server-side boundaries.
- The UI-extension source contains no access token/client secret and requires a separately signed
  platform endpoint.

## Constraints And Follow-Up Debt

- The integration is intentionally static/private and single-portal. Multi-portal installation,
  OAuth token lifecycle, and the Webhook Journal client-credentials model remain deferred.
- Two unique CRM properties, association labels, private-app scopes, webhook subscriptions, and UI
  record-card placement are manual portal provisioning steps. The application health check reports
  them but does not mutate portal schema.
- Standard push webhooks are documented for supported contact/deal events; client/campaign custom
  objects retain incremental search and daily reconciliation coverage.
- Legacy `hubspot.push.batch` data and compatibility endpoints remain. They are no longer an active
  product action, but eventual data-retention/removal work should be handled separately.
- Conflict resolution mutations are intentionally not generalized. New conflicts are inspectable;
  a future resolver must use approved field-specific ADR-002 behavior and audit every change.
- `/hubspot-app` still requires placeholder replacement, a developer-test upload/install, and
  portal-side validation before it can be considered deployed.

## Current HubSpot Data And Queue Shape

Important HubSpot V2 tables/models include:

- identity/links: `hubspot_portals`, `hubspot_contact_links`, `hubspot_deal_links`;
- diagnostics: `hubspot_health_check_runs`, with durable queued/running/completed/failed state;
- references: `hubspot_owners`, `hubspot_pipelines`, `hubspot_pipeline_stages`,
  `hubspot_association_definitions`, and portal-aware `dropdown_values`;
- outbound: `hubspot_import_batches`, `hubspot_import_batch_rows`, plus retained legacy push rows;
- inbound/reconciliation: `hubspot_object_sync_runs`, `hubspot_sync_cursors`,
  `hubspot_webhook_events`, and `hubspot_conflicts`.

Current job names are:

- `runs.discover`
- `runs.recompute`
- `runs.assess.channel-fit`
- `channels.enrich.llm`
- `channels.enrich.hypeauditor`
- `imports.csv.process`
- `exports.csv.generate`
- `hubspot-preview.enrich`
- `hubspot.import.batch`
- `hubspot.push.batch` (legacy compatibility)
- `hubspot.health-check`
- `hubspot.object-sync.schedule`
- `hubspot.object-sync`
- `hubspot.webhook.process`
- `maintenance.refresh-stale`

## Conclusion

As of 2026-07-20, the repository has one active run-scoped HubSpot delivery model: direct Object
API/association sync with a CSV fallback. The local architecture contains the durable identity,
reconciliation, webhook, conflict, health, and UI-extension foundations required for a controlled
single-portal rollout. Production readiness still depends on the manual provisioning and staged
validation steps in [`docs/setup/hubspot-v2.md`](./setup/hubspot-v2.md); those steps are not implied
to have occurred.
