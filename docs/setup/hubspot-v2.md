# HubSpot Integration V2 Setup and Operations

This is the canonical operator guide for the repository's single-portal HubSpot integration. It
covers local configuration and the HubSpot-side work that must be completed manually. The
application does not create HubSpot properties, association labels, webhook subscriptions, or UI
extension installations.

No live portal provisioning, installation, feature enablement, or intentional verification was
performed while this implementation was prepared. During local verification, a test-isolation gap
allowed one authenticated schema read and one contact PATCH attempt against a configured portal;
the PATCH returned a provider error and no successful portal write was observed. The affected tests
now clear both supported token variables before execution, and all final gates ran with provider
credentials explicitly blanked. Validate every portal-specific internal name and identifier in a
HubSpot developer test account or staging portal before enabling a production feature flag.

## Integration shape

- Authentication is a private/static, single-portal access token. OAuth and multi-portal installs
  are deferred.
- The API adapter targets HubSpot CRM API family `2026-03` and defaults to
  `https://api.hubapi.com`.
- Direct run delivery uses CRM Object API batch upserts followed by the Associations API. It does
  not use the Imports API as its primary transport.
- `atlas_contact_id` and `atlas_run_id` are the stable contact/deal keys.
  Email is useful for initial matching, but it is not the durable integration identity.
- The platform stores returned contact/deal IDs and portal-aware links before creating
  associations. A retry preserves successful records and targets only retryable failures.
- A durable CSV batch remains available as an explicit fallback. Generating a CSV means the file
  is ready to download; it does not mean HubSpot imported it.
- Clients, campaigns, owners, pipelines/stages, property option internal values, and directional
  association definitions are HubSpot-owned references. Creator catalog fields remain governed by
  the platform and ADR-002.

## Private app and scopes

Create or select one HubSpot private app for the target portal and provision the least-privilege
scopes needed by the features that will be enabled. The V2 read/write and health paths require the
following starting set:

- `crm.objects.contacts.read`
- `crm.objects.contacts.write`
- `crm.objects.deals.read`
- `crm.objects.deals.write`
- `crm.objects.owners.read`
- `crm.schemas.contacts.read`
- `crm.schemas.deals.read`
- `crm.objects.custom.read`
- `crm.schemas.custom.read`
- `crm.objects.custom.write` when direct sync creates associations to client/campaign custom
  objects

The static app in `hubspot-app/src/app/app-hsmeta.json` represents this same single integration
app, not a second extension-only credential. Keep its `requiredScopes` aligned with the enabled V2
backend features so the generated static access token can run health, reference sync, direct
delivery, and the record cards under one portal identity. A two-app credential model is not
implemented by this configuration contract.

HubSpot can change how scopes are presented for an account or app type. Confirm the generated
scope list in the private-app UI. The read-only health report can identify forbidden endpoints and
some missing capabilities, but it cannot prove every scope from a token response alone.

Keep the access token and client secret server-side. Never add them to a `NEXT_PUBLIC_*` variable,
the UI-extension source, logs, screenshots, or database rows.

## Server configuration

Set HubSpot variables consistently on both `web` and `worker` unless this guide explicitly says a
value is web-only. The centralized integration loader uses the following contract:

| Variable | Purpose |
|---|---|
| `HUBSPOT_ACCESS_TOKEN` | Preferred private-app bearer token. Required for provider calls. |
| `HUBSPOT_API_KEY` | Deprecated compatibility fallback, read only when `HUBSPOT_ACCESS_TOKEN` is empty. Remove after all environments migrate. |
| `HUBSPOT_BASE_URL` | Optional adapter base URL; leave at `https://api.hubapi.com` outside mocked tests. |
| `HUBSPOT_PORTAL_ID` | Numeric HubSpot account/portal ID. Required for portal-aware links, webhooks, and record URLs. |
| `HUBSPOT_APP_ID` | Numeric HubSpot application ID used to validate signed UI-extension app context. This is not the OAuth client ID. |
| `HUBSPOT_CLIENT_ID` | OAuth client identifier, retained for app models or future OAuth flows that require it. It is not accepted as the UI-extension `appId`. |
| `HUBSPOT_CLIENT_SECRET` | App client secret used for HubSpot v3 request-signature verification. |
| `HUBSPOT_DIRECT_SYNC_ENABLED` | Enables direct CRM Object API delivery. Strict `true`/`false`; defaults to `false`. |
| `HUBSPOT_WEBHOOKS_ENABLED` | Enables signed webhook ingestion. Strict `true`/`false`; defaults to `false`. |
| `HUBSPOT_WEBHOOK_JOURNAL_ENABLED` | Reserved for a future OAuth/client-credentials Webhook Journal path. Keep `false`. |
| `HUBSPOT_UI_EXTENSIONS_ENABLED` | Enables the signed UI-extension context endpoint. Strict `true`/`false`; defaults to `false`. |
| `HUBSPOT_CONTACT_UNIQUE_ID_PROPERTY` | Contact unique-property internal name; use `atlas_contact_id`. |
| `HUBSPOT_CONTACT_WORKED_WITH_PROPERTY` | HubSpot-authoritative Contact single-checkbox property; current portal uses `worked_with`. |
| `HUBSPOT_DEAL_UNIQUE_ID_PROPERTY` | Deal unique-property internal name; use `atlas_run_id`. |
| `HUBSPOT_CLIENT_OBJECT_TYPE` | Portal client custom-object type ID/internal API name. |
| `HUBSPOT_CAMPAIGN_OBJECT_TYPE` | Portal campaign custom-object type ID/internal API name. |
| `HUBSPOT_ACTIVATION_OBJECT_TYPE` | Portal activation custom-object type ID/internal API name that owns the `activation_type` enumeration. |
| `HUBSPOT_DEAL_CAMPAIGN_ASSOCIATION_TYPE_ID` | Optional portal-specific Deal → Campaign directional type ID. Use only when discovery is ambiguous. |
| `HUBSPOT_DEAL_CLIENT_ASSOCIATION_TYPE_ID` | Optional portal-specific Deal → Client directional type ID. Use only when discovery is ambiguous. |
| `HUBSPOT_CAMPAIGN_CLIENT_ASSOCIATION_TYPE_ID` | Portal-specific Campaign → Client directional type ID used when campaigns do not carry the client object ID as a property. |

Only literal `true` enables a HubSpot feature. An omitted flag is off, and invalid non-boolean text
fails configuration parsing instead of enabling a feature accidentally.

The V2 client has bounded defaults of a 15-second request timeout, three retries, a 250 ms base
delay, and a 30-second maximum retry delay. It respects `Retry-After` and captures safe provider
correlation identifiers. These are adapter options for code/tests, not environment variables.

### Custom-object property mappings

Use internal API names, never display labels:

| Object | Required mapping | Optional mappings |
|---|---|---|
| Client | `HUBSPOT_CLIENT_NAME_PROPERTY` | `HUBSPOT_CLIENT_DOMAIN_PROPERTY`, `HUBSPOT_CLIENT_COUNTRY_REGION_PROPERTY`, `HUBSPOT_CLIENT_CITY_PROPERTY`, `HUBSPOT_CLIENT_ACTIVE_PROPERTY` |
| Campaign | `HUBSPOT_CAMPAIGN_NAME_PROPERTY`, `HUBSPOT_CAMPAIGN_STATUS_PROPERTY` | `HUBSPOT_CAMPAIGN_MARKET_PROPERTY`, `HUBSPOT_CAMPAIGN_BRIEF_LINK_PROPERTY`, `HUBSPOT_CAMPAIGN_MONTH_PROPERTY`, `HUBSPOT_CAMPAIGN_YEAR_PROPERTY`, `HUBSPOT_CAMPAIGN_ACTIVE_PROPERTY` |
| Activation | `HUBSPOT_ACTIVATION_NAME_PROPERTY` | `HUBSPOT_ACTIVATION_TYPE_PROPERTY`, `HUBSPOT_ACTIVATION_URL_PROPERTY`, `HUBSPOT_ACTIVATION_PUBLICATION_DATE_PROPERTY` |

For portal `147403025`, the read-only Deal-record inspection on 2026-07-21 verified Client
`2-198744797`, Client Campaign `2-196889646`, and Activation `2-200856187` as the association
object types. Deal history reads the standard properties `dealname`, `amount`,
`deal_currency_code`, `dealstage`, `hubspot_owner_id`, `closedate`, and `createdate`.

The current object-sync compatibility contract also requires exactly one of:

- `HUBSPOT_CAMPAIGN_CLIENT_OBJECT_ID_PROPERTY`: a campaign property containing its client HubSpot
  object ID; or
- `HUBSPOT_CAMPAIGN_CLIENT_ASSOCIATION_TYPE_ID`: a positive, portal-specific directional
  association type ID.

Do not set both. Prefer a discovered association when the portal exposes the intended labeled
relationship. The explicit type-ID setting is a fallback, not a value that should be copied between
portals.

Deal → Campaign is discovered automatically when exactly one directional definition exists. If
the portal has multiple Deal → Campaign labels, set
`HUBSPOT_DEAL_CAMPAIGN_ASSOCIATION_TYPE_ID` to the intended Deal → Campaign type ID. Do not use the
reverse Campaign → Deal type ID: HubSpot assigns different IDs to each direction.

Deal → Client follows the same rule. Set `HUBSPOT_DEAL_CLIENT_ASSOCIATION_TYPE_ID` only if the
portal exposes multiple plausible Deal → Client definitions, and use the forward Deal → Client ID
rather than the reverse Client → Deal ID.

## Portal provisioning

### 1. Create the two unique properties

Provision these manually in HubSpot before direct sync is enabled:

| Object | Suggested label | Required internal name | Requirements |
|---|---|---|---|
| Contact | Atlas contact ID | `atlas_contact_id` | Single-line text, unique value enforced |
| Deal | Atlas run ID | `atlas_run_id` | Single-line text, unique value enforced |

Set the two matching environment variables to those internal names. Do not reuse a property whose
values have different semantics. The health check is intentionally read-only and will report a
missing or non-unique property; it will not repair the portal schema.

### 2. Identify custom objects and properties

Record the portal-specific client, campaign, and activation object type identifiers and every
property internal name listed above. The activation object must expose the `activation_type`
enumeration used to populate the platform dropdown. A label such as `Campaign Status` is not an
API value. For enumeration fields, the platform displays the option label but persists and writes
the HubSpot option's internal value.

Leave an optional property variable empty if that property does not exist. The outbound writer
omits unknown/empty values and sends an empty string only for an explicit audited clear operation.

Direct delivery also validates the fixed outbound property contract below. Native HubSpot fields
must be readable and the custom fields must be provisioned with these exact internal names before
health can pass:

| Object | Required outbound internal names |
|---|---|
| Contact | `email`, `firstname`, `lastname`, `phone`, `contact_type`, `platforms`, `influencer_type`, `influencer_vertical`, `country`, `language`, `youtube_url`, `youtube_handle`, `influencer_url`, `youtube_followers`, `youtube_video_median_views`, `youtube_shorts_median_views`, `youtube_engagement_rate`, `influencer_size`, `worked_with`, plus the configured contact unique-ID property |
| Deal | `dealname`, `pipeline`, `dealstage`, `hubspot_owner_id`, `deal_currency_code`, `dealtype`, `activation_type`, `amount`, `closedate`, `createdate`, plus the configured deal unique-ID property |

Dropdown-backed values such as deal type and activation type are sent using the synchronized
HubSpot option internal value, not the display label. The health check reads this contract but
never creates a missing property.

### 3. Provision and discover associations

Create or identify directional relationships required by the portal model:

- contact to deal (for example, label `Scouted creator`);
- deal to campaign;
- deal to client;
- deal to activation;
- campaign to client.

Association labels and numeric type IDs are directional and portal-specific. Run reference/object
sync after provisioning so the platform can discover and persist both directions. Do not paste an
ID from another portal and do not compile one into source. If health reports more than one plausible
label, resolve the portal ambiguity rather than guessing.

### 4. Synchronize references

From the admin-only Database HubSpot panel, run the connection health check and then run HubSpot
object/reference sync. Reference data includes:

- portal/account identity;
- owner ID, normalized email/name, and active/archive state;
- pipeline and stage IDs plus display labels;
- property option labels and internal values;
- client/campaign object type and property validation state; and
- directional association labels/type IDs.

Campaign managers resolve to an active HubSpot owner by normalized email. No match or multiple
matches is a blocker; the platform does not guess an owner.

Object reconciliation uses persisted per-portal/object high-water marks and periodic safety scans.
Explicit archived state can deactivate a local HubSpot-owned reference. Absence from one response
does not delete a client, campaign, contact, deal, or historical link. The daily schedule runs at
midnight in `Europe/Zagreb`.

## Connection health

An admin can open Database and use the HubSpot integration panel:

- `GET /api/database/hubspot-health` returns the last persisted report plus the latest durable
  health-check run for polling.
- `POST /api/database/hubspot-health` persists and queues a fresh read-only check, then returns
  `202 Accepted`; `hubspot.health-check` performs provider reads in the worker.
- `GET /api/database/hubspot-conflicts?status=open` lists durable inbound disagreements without
  changing canonical creator data.

The health report covers configured portal identity, token/API reachability, unique properties,
custom-object mappings, owners, pipelines/stages, association/reference state, feature flags, and
last synchronization/webhook timestamps where available. Treat every blocker as actionable. A
healthy report does not write a test contact, deal, property, label, or association.
Direct delivery requires a successful health check from the last 24 hours; rerun the read-only
check when readiness reports that the stored result is stale.

## Direct delivery and CSV fallback

The run handoff workspace at `/exports/prepare/[runId]` contains one HubSpot delivery surface:

- **Sync to HubSpot** requests `direct_object_api` mode when direct sync is enabled and health is
  ready.
- **Download HubSpot CSV** requests `csv_fallback` mode and keeps the manual import path available.

`hubspot.import.batch` is a resumable state machine. It prepares an immutable durable snapshot of
the run and creator/provider values, batch-upserts at
most 100 contacts per provider request, upserts one logical deal for the run, persists returned
IDs, creates explicit associations, and completes as success, partial success, or failure. Repeated
clicks reuse the same active/idempotent batch. Failed-row retry does not resubmit successful rows or
recreate the deal.

Legacy `hubspot.push.batch` records and compatibility endpoints remain available for historical
support. The compatibility executor uses checkpointed batch upserts and preserves already-pushed
rows on retry, but the contact-only push is not an active product action.

## Queue family

| Job | Role | Default worker concurrency variable |
|---|---|---|
| `hubspot-preview.enrich` | Prepares/enriches HubSpot handoff values | `WORKER_HUBSPOT_PREVIEW_ENRICH_CONCURRENCY=1` |
| `hubspot.import.batch` | Direct Object API/association state machine or CSV fallback generation | `WORKER_HUBSPOT_IMPORT_BATCH_CONCURRENCY=1` |
| `hubspot.push.batch` | Legacy compatibility processing only | `WORKER_HUBSPOT_PUSH_BATCH_CONCURRENCY=1` |
| `hubspot.health-check` | Read-only portal/schema/reference diagnostics | `WORKER_HUBSPOT_HEALTH_CHECK_CONCURRENCY=1` |
| `hubspot.object-sync.schedule` | Creates the daily `Europe/Zagreb` reconciliation run | `WORKER_HUBSPOT_OBJECT_SYNC_SCHEDULE_CONCURRENCY=1` |
| `hubspot.object-sync` | Reference, client/campaign, and collaboration-history reconciliation | `WORKER_HUBSPOT_OBJECT_SYNC_CONCURRENCY=1` |
| `hubspot.webhook.process` | Idempotent asynchronous webhook handling/conflict detection | `WORKER_HUBSPOT_WEBHOOK_CONCURRENCY=2` |

Each externally meaningful workflow persists status, timestamps, retry/error state, and safe
correlation metadata. Worker recovery monitors re-enqueue persisted health checks committed before
a web-process interruption and atomically reclaim stale direct, CSV-fallback, and legacy delivery
leases. Exact-owner execution fences prevent a previous worker from committing after takeover, and
recoverable enqueue failures remain persisted for the next monitor pass. Provider polling/retry
never waits indefinitely inside a web request.

## Webhooks

The public target is:

```text
https://<public-platform-origin>/api/integrations/hubspot/webhooks
```

The local `2026.03` project manifest at
`hubspot-app/src/app/webhooks/scouting-platform-webhooks-hsmeta.json` defines the reviewed contact
and deal subscriptions using HubSpot's current generic `object.*` format. All subscriptions ship
inactive. Generic deliveries are resolved from `objectTypeId` (`0-1` for contacts and `0-3` for
deals); unrecognized generic object types are rejected instead of being silently journaled as an
unsupported object. Do not infer arbitrary custom-object support. Client/campaign/activation and
association changes continue to use periodic reconciliation. `HUBSPOT_WEBHOOK_JOURNAL_ENABLED` remains
off until a separately reviewed OAuth/client-credentials Journal design exists.

Before registering the target:

1. Ensure the externally visible HTTPS origin and proxy forwarding are stable.
2. Set the numeric `HUBSPOT_PORTAL_ID` and the app's `HUBSPOT_CLIENT_SECRET` on `web` and `worker`.
3. Deploy the route while `HUBSPOT_WEBHOOKS_ENABLED=false`.
4. Replace the placeholder origin in the webhook manifest, review its still-inactive subscriptions,
   and upload/install the project through the human-run developer-test workflow.
5. Activate only the reviewed subscriptions after the endpoint is reachable, then enable the flag
   and restart the relevant services.

For Collaboration History, the reviewed inactive manifest includes `worked_with` and the mirrored
Deal properties `dealname`, `pipeline`, `dealstage`, `deal_currency_code`, `amount`,
`hubspot_owner_id`, and `closedate`. The daily object sync remains authoritative for Contact → Deal
and Deal → Client/Campaign/Activation membership and activation fields; webhooks only accelerate
updates between reconciliations.

The webhook route intentionally does not require Auth.js. It preserves the raw request body and
authenticates the sender with HubSpot signature v3: method + exact external URI + body + timestamp,
a five-minute replay window, and constant-time comparison. The externally visible URI must match
what HubSpot signed; an incorrect reverse-proxy host or scheme will make every delivery fail.

Accepted deliveries are minimally persisted with a portal-scoped dedupe key and queued as
`hubspot.webhook.process`. Delivery is at least once and can be out of order. Processing updates
portal links/mirror timestamps or creates a conflict; it never overwrites an admin manual override
or deletes a creator because one event is missing. Per-object transaction locks serialize
concurrent deliveries, while per-property observation cursors ensure a newer property-A event does
not suppress a valid older property-B event.

## Access-token and client-secret rotation

### Rotate the private-app access token

1. Set `HUBSPOT_DIRECT_SYNC_ENABLED=false` and avoid the daily object-sync window; pause the worker
   if all HubSpot reads/writes must stop immediately.
2. Generate a replacement token in the same portal with the same reviewed scopes.
3. Replace `HUBSPOT_ACCESS_TOKEN` on both `web` and `worker`; do not fall back to
   `HUBSPOT_API_KEY`.
4. Restart both services and run the read-only connection health check.
5. Revoke the old token only after the new token passes health.
6. Re-enable direct sync after one staging/test batch succeeds.

### Rotate the app client secret

1. Set `HUBSPOT_WEBHOOKS_ENABLED=false`; expect HubSpot to retry deliveries received during the
   controlled interruption.
2. Rotate the secret in HubSpot, update `HUBSPOT_CLIENT_SECRET` on both services, and restart them.
3. Run health, then enable webhooks and confirm new events leave the durable queue.
4. If the UI extension is installed, validate one signed card request after the same rotation.

There is no dual-secret grace period in the current config contract. Keep the interruption short
and never log either old or new secret.

## Safe rollout

1. Deploy the additive schema and application code with all four HubSpot flags set to `false`.
2. Run the read-only health check.
3. Provision the two unique properties and required association labels/mappings manually.
4. Run reference/object sync and resolve owner, pipeline/stage, option-value, and association
   blockers.
5. Enable direct sync in staging or for the intended controlled environment.
6. Validate one non-production run, including HubSpot IDs/links and associations, then enable the
   broader workflow.
7. Keep CSV fallback and daily reconciliation available.
8. Configure the webhook URL/client secret, enable webhook processing, and observe durable event
   status/conflicts.
9. Upload/install the UI extension separately only after its developer-test validation succeeds.

These are operator steps, not a record of completed live validation.

## Rollback

1. Set `HUBSPOT_DIRECT_SYNC_ENABLED=false`, `HUBSPOT_WEBHOOKS_ENABLED=false`,
   `HUBSPOT_WEBHOOK_JOURNAL_ENABLED=false`, and `HUBSPOT_UI_EXTENSIONS_ENABLED=false` to stop new
   V2 entry points.
2. Pause the worker only if already queued provider work must be frozen; otherwise retain its
   persisted state for diagnosis/retry.
3. Use **Download HubSpot CSV** for the outbound handoff while direct delivery is disabled.
4. Preserve portal/link, webhook, conflict, and batch rows. Do not delete identities or retry all
   rows indiscriminately.
5. Roll application services back only to a revision compatible with the additive database schema.
   Do not improvise a Prisma down-migration; prefer a forward fix.
6. Re-run read-only health before restoring any flag.

Disabling webhooks does not remove HubSpot-side subscriptions. Remove or pause them in the app
configuration if the endpoint will be unavailable for an extended period.

## UI extension: manual developer-test deployment

`/hubspot-app` is a standalone HubSpot developer-platform `2026.03` project. It is intentionally
outside the pnpm workspace and is not uploaded by application builds.

Before any upload:

1. Replace every `scouting.example.com` and support placeholder in
   `hubspot-app/src/app/app-hsmeta.json` and
   `hubspot-app/src/app/cards/ScoutingContextCard.jsx`, plus the webhook target in
   `hubspot-app/src/app/webhooks/scouting-platform-webhooks-hsmeta.json`, with the same
   production-like HTTPS origin.
2. Keep `/api/integrations/hubspot/extension/context` aligned in both files. Add that exact URL to
   `permittedUrls.fetch`.
3. Set `HUBSPOT_PORTAL_ID`, `HUBSPOT_APP_ID`, `HUBSPOT_CLIENT_SECRET`, and
   `NEXT_PUBLIC_APP_URL` on the platform. Leave `HUBSPOT_UI_EXTENSIONS_ENABLED=false` until the
   signed endpoint is deployed.
4. For a campaign card, copy
   `campaign-context-card-hsmeta.json.example` to a filename ending in `-hsmeta.json`, replace
   `p_REPLACE_WITH_CAMPAIGN_OBJECT_NAME` with the target portal's discovered campaign object name,
   and add the required custom-object read scope.
5. Review the webhook manifest with every subscription still inactive; activation happens only
   after the signed endpoint and feature flag are ready in the controlled environment.
6. Install the current HubSpot CLI, authenticate to a developer account, enter `hubspot-app`, and
   run `hs project upload` only after reviewing the generated project metadata.
7. In HubSpot, install the uploaded build into a developer test account, place the contact/deal
   cards on record sidebars, and test linked and unlinked records. Test the optional campaign card
   only against the exact configured custom object.
8. Enable `HUBSPOT_UI_EXTENSIONS_ENABLED` in that controlled environment and validate that signed
   fetches reject the wrong portal, app, user, or record context.
9. Treat installation in the intended portal as a separate human-approved action.

`hubspot.fetch()` supplies signed portal/user/app context. No access token or client secret belongs
in the extension bundle. This repository contains the scaffold and local tests only; it does not
claim an upload, installation, record-layout placement, or live portal result.

## Official HubSpot references

- [App scopes](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes)
- [CRM Object APIs](https://developers.hubspot.com/docs/api-reference/latest/crm/using-object-apis)
- [Properties and unique identifiers](https://developers.hubspot.com/docs/api-reference/latest/crm/properties/guide)
- [Associations](https://developers.hubspot.com/docs/api-reference/latest/crm/associations/overview)
- [Association labels](https://developers.hubspot.com/docs/api-reference/latest/crm/associations/associations-schema/guide)
- [Owners](https://developers.hubspot.com/docs/api-reference/latest/crm/owners/guide)
- [Pipelines](https://developers.hubspot.com/docs/api-reference/latest/crm/pipelines/guide)
- [Webhook request validation](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/request-validation)
- [Webhooks](https://developers.hubspot.com/docs/api-reference/latest/webhooks/guide)
- [UI extensions](https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/overview)
