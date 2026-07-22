# HubSpot Collaboration History and Dashboard Status Plan

- Status: Approved
- Date: 2026-07-21
- Branch: `codex/hubspot-integration-v2`
- Governing decision: [`ADR-005`](../ADR-005-hubspot-integration-boundaries.md)
- Extends: [`HubSpot Integration V2 Implementation Plan`](./2026-07-hubspot-integration-v2.md)

## Objective

Add locally synchronized HubSpot collaboration history to catalog creator profiles and expose the existing run-level HubSpot import batch status on the Dashboard without introducing browser-to-HubSpot requests, request-path provider calls, a second status model, or CRM conflict/health UI on the creator profile.

## Verified portal mapping

The signed-in HubSpot portal `147403025` was inspected read-only on 2026-07-21. No HubSpot records or schema were changed.

| Portal label | HubSpot representation |
| --- | --- |
| Deal Name | Deal property `dealname` |
| Amount | Deal property `amount` |
| Currency | Deal property `deal_currency_code` |
| Deal Stage | Deal property `dealstage` plus the synchronized pipeline/stage reference label |
| Deal owner | Deal property `hubspot_owner_id` plus the synchronized owner display name |
| Close Date | Deal property `closedate` |
| Create Date | Deal property `createdate` / provider record creation timestamp |
| Client | Association to object type `2-198744797` |
| Campaign / Client Campaign | Association to object type `2-196889646` |
| Activations | Association to object type `2-200856187` |
| Activation Name | Activation property `activation_name` |
| Activation Type | Activation property `activation_type` |
| Activation URL | Activation property `activation_url` |
| Publication Date | Activation property `publication_date` |
| Worked with | Contact single-checkbox property `worked_with` |

The object type IDs remain deployment configuration through the existing HubSpot object mappings. The verified custom property names are added to deployment configuration and health validation rather than inferred at runtime.

## Data flow

1. Extend the existing durable HubSpot object reconciliation run; do not add a new queue family or execution-status model.
2. The integrations package batch-reads linked HubSpot Contacts and their Deal associations, batch-reads the associated Deals and Activations, and reads Deal associations to Client, Campaign, and Activation objects.
3. Core reconciliation stores HubSpot-authoritative Contact `worked_with` observations, Deal mirrors, Activation mirrors, and explicit local association rows. Full reconciliation replaces association rows only after complete provider reads; missing records never imply deletion.
4. Deal/contact webhook property events update known local mirrors when subscribed. Standard webhooks remain a freshness optimization; scheduled reconciliation remains the completeness path, including custom objects and HubSpot-created Deals.
5. The catalog channel detail query reads only local mirrors. It combines all linked Contacts for the creator and naturally deduplicates by the portal-scoped HubSpot Deal ID.
6. The Dashboard run query selects the same persisted `HubspotImportBatch` status used by `/exports/prepare/[runId]`: prefer an active batch, otherwise use the newest batch, and return `null` when no batch exists.
7. A shared frontend presentation helper owns HubSpot import status labels and active-state detection for both the prepare page and Dashboard.

## Schema changes

Add one deterministic Prisma migration after `20260720120000_hubspot_integration_v2` containing only additive tables, columns, indexes, and foreign keys for:

- portal-scoped HubSpot Deal mirrors;
- portal-scoped HubSpot Activation mirrors;
- Contact-to-Deal, Deal-to-Client, Deal-to-Campaign, and Deal-to-Activation association rows; and
- durable collaboration reconciliation counters on the existing object-sync run.

No catalog canonical field or manual override is overwritten. HubSpot-owned values remain isolated in HubSpot mirror tables/link snapshots.

**Review requirement:** this Prisma migration crosses DB and UX ownership and must be reviewed by both Ivan and Marin before merge.

## UI scope

- Catalog creator profile: one `Worked with` field and a section named exactly `Collaboration History`.
- Each collaboration shows Deal name/link, Client, Campaign, Amount/Currency, Activations, Deal stage, Deal owner, Close Date, and Create Date, with a clear no-deals empty state.
- Dashboard: one non-filterable `HubSpot sync status` column. It adds no HubSpot filters or additional CRM metadata.
- No HubSpot card changes, conflict UI, sync-health UI, lifecycle labels, or recommendation changes.

## Test plan

- Contracts: collaboration DTOs and nullable run-level batch status.
- Integrations: mocked HubSpot batch object reads and association pagination/normalization; no live credentials.
- Domain/integration: multiple linked Contacts, HubSpot-created Deals, Deal-ID deduplication, authoritative `worked_with`, association replacement, archive preservation, and persisted reconciliation counters/failures.
- Migration safety: deterministic SQL, no secrets/runtime DDL, pre-feature data preservation, required indexes/foreign keys, and full migration application.
- Routes/components: authenticated channel detail response, Collaboration History rendering/empty state, exact Worked with label, shared status labels, Dashboard column, and no new filters.
- Playwright: catalog profile collaboration history and Dashboard statuses including `Not synced`.

## Rollout

1. Review the additive migration with both repository owners.
2. Deploy schema and code before enabling or relying on the new mirrors.
3. Configure and health-check the verified Contact/Activation property mappings and the existing Client/Campaign/Activation object type mappings.
4. Provision relevant standard Contact/Deal property webhook subscriptions where supported; do not infer custom-object webhook coverage.
5. Run a full HubSpot reconciliation to backfill existing HubSpot-created Deal associations before treating catalog history as complete.

