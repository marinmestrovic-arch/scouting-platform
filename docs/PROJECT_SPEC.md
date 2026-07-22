# Project Specs

Current product spec for the implemented repository state as of 2026-07-20.

## 1. Product Definition

`scouting-platform` is an internal creator scouting tool centered on active campaigns.

The current product combines:
- a shared creator catalog
- campaign and client reference data
- campaign-linked scouting runs
- automated enrichment plus approval-gated HypeAuditor reports
- admin-operated imports and manual overrides
- CSV export plus durable direct HubSpot sync with a downloadable CSV fallback

## 2. Workspace Model

The primary authenticated workspace surfaces are:
- `Dashboard`
- `New scouting`
- `Catalog`
- `Database`
- `Admin`

Supporting workflow pages exist for:
- run details
- CSV export preparation and batch history
- a shared handoff workspace with direct HubSpot delivery, per-row results, and CSV fallback history

The current naming matters:
- `Catalog` is the creator-browsing surface
- `Database` is the reference-data surface for clients, campaigns, and admin dropdown values
- `Dashboard` is the run-monitoring and handoff surface

## 3. Auth and User Model

Authentication is email + password. Sign-up is disabled. Admins create and manage accounts.

The product uses two distinct user concepts:

### Permission boundary: `role`

Values:
- `admin`
- `user`

`role` controls:
- access to Admin navigation
- admin-only routes
- privileged mutations such as user management, CSV imports, approvals, and dropdown administration

### Business persona: `userType`

Values:
- `admin`
- `campaign_manager`
- `campaign_lead`
- `hoc`

`userType` controls business-facing workflow semantics:
- `campaign_manager` is the selectable persona for run ownership/assignment
- `campaign_lead` and `hoc` can create campaigns and clients inside the Database workspace
- `admin` is reserved for `role=admin` accounts

Non-admin users are not all the same persona anymore. Current product docs should refer to them as users with a `userType`, not blanket "campaign managers."

## 4. Account and Integration Ownership

### User-owned credential
- YouTube Data API key

### Company-owned credentials
- OpenAI API key
- HypeAuditor API key
- HubSpot private-app access token and app client secret

### Operational rule
- admins assign and update user YouTube keys
- users do not self-manage YouTube keys in the current implementation

## 5. Current Implemented Capabilities

### Dashboard
- lists recent runs
- filters by campaign manager, client, and market
- shows run coverage against target
- links into run detail, CSV preparation, and HubSpot preparation

### New scouting
- starts from an active campaign
- requires an influencer list name, campaign, campaign manager, target, and prompt
- stores campaign-derived metadata on the run snapshot

### Catalog
- browses creators in the canonical catalog
- supports creator detail views, saved segments, enrichment actions, and admin manual overrides

### Database
- manages clients and campaigns
- exposes admin-only HubSpot connection health, conflicts, reference sync, and dropdown values
- retains option display labels and their distinct HubSpot internal values
- keeps campaign/client reference data separate from creator catalog browsing

### Admin
- user management
- YouTube key assignment
- approval queue for HypeAuditor advanced reports
- CSV import history and detail
- admin dashboard summaries

## 6. Campaign-Linked Scouting Workflow

Runs are campaign-linked.

When a user creates a run:
1. the app validates the authenticated user and assigned YouTube key
2. the user selects an active campaign
3. the user selects a campaign manager from active Campaign Manager users
4. the system copies campaign-derived metadata onto the run snapshot
5. discovery searches both the catalog and YouTube
6. results are stored as a reproducible snapshot in `run_results`

The run snapshot currently preserves:
- campaign identifiers and labels: `campaignId`, `campaignName`, `client`, `market`
- campaign planning metadata: `briefLink`, `month`, `year`
- ownership and outbound defaults: `campaignManagerUserId`, `dealOwner`, `dealName`, `pipeline`, `dealStage`
- HubSpot prep fields: `currency`, `dealType`, `activationType`, `hubspotInfluencerType`, `hubspotInfluencerVertical`, `hubspotCountryRegion`, `hubspotLanguage`

The key behavior is:
- runs remain snapshots
- catalog data remains canonical
- run metadata is preserved so Dashboard, CSV preparation, and HubSpot preparation can work from the same stored context

## 7. Campaign Manager Selection Rule

Campaign manager assignment is intentionally constrained.

The selectable campaign manager list comes from active users where:
- `role = user`
- `userType = campaign_manager`
- `isActive = true`

The API and core service both enforce this rule. Campaign leads, HOC users, and admins are not valid campaign-manager assignments.

## 8. Reference Data Model

The current reference-data surface includes:
- clients
- markets
- campaigns
- dropdown values used for HubSpot preparation defaults and row edits, including portal/property
  provenance and HubSpot internal values
- portal-scoped owners, pipelines/stages, and directional association definitions

Current Database workspace behavior:
- clients: list/create
- campaigns: list/create and active filtering
- dropdown values: admin-only list/replace
- HubSpot: admin-only read-only health, durable object/reference sync history, and read-only conflict
  inspection

Campaign creation is available to:
- admins
- `campaign_lead` users
- `hoc` users

## 9. Export and HubSpot Surface

### CSV export
- users can create CSV export batches from selected creators or filtered catalog scopes
- exports are background-safe and downloadable by batch id
- CSV preparation pages show the full run-derived export table before download

### HubSpot direct sync
- users open the run-scoped handoff page at `/exports/prepare/[runId]`
- direct delivery is unavailable until the safe-off feature flag is enabled and portal health is
  ready
- the app exposes required-field validation issues before batch creation
- shared dropdown defaults and per-row overrides can be edited before delivery
- the direct path batch-upserts contacts and one run deal using stable custom unique identifiers,
  persists returned HubSpot IDs, then creates explicit discovered associations
- repeated submission reuses the idempotent batch; partial failure preserves successful rows and
  retry targets only retryable failures
- per-row HubSpot contact/deal links, errors, and partial-success state remain reviewable

### HubSpot CSV fallback and compatibility
- users can generate and download the same prepared data as a durable CSV fallback
- CSV completion means the file is ready; it is not represented as a completed HubSpot-side import
- legacy contact-only push history/endpoints remain available for compatibility, but there is no
  active legacy-push product action

### HubSpot inbound safety
- an admin-only read-only health check reports portal configuration and provisioning blockers
- signed contact/deal webhooks are deduplicated and processed asynchronously
- client/campaign custom objects use incremental search plus daily `Europe/Zagreb` reconciliation
- missing records are not deleted merely because they are absent from one poll
- shared-field disagreement creates a durable read-only conflict rather than overwriting canonical
  creator data or manual overrides

## 10. API-Supported Product Surface

The UI currently depends on route families for:
- campaigns
- clients
- campaign-manager lookup
- dropdown values
- runs and run previews
- CSV export batches and downloads
- direct/CSV HubSpot import batches, detail, failed-row retry, and downloads
- HubSpot connection health, reference/object sync, and conflicts
- provider-authenticated HubSpot webhook and UI-extension context routes
- catalog browsing and saved segments
- admin approvals, users, imports, and manual overrides

These are implemented interfaces, not future-plan placeholders.

## 11. Security and Data Rules

- provider secrets stay server-side
- user YouTube keys are encrypted at rest
- authorization is enforced server-side
- admin-only actions remain admin-only even if UI visibility fails
- privileged actions are audited
- automated data never overwrites active admin manual overrides

Resolved field precedence remains:
1. `admin_manual`
2. `csv_import`
3. `hypeauditor`
4. `llm`
5. `heuristics`
6. `youtube_raw`

## 12. Explicit Non-Goals

Still out of scope in the current implementation:
- public sign-up
- browser-direct provider integrations
- multi-tenant organizations
- multi-portal HubSpot OAuth and the Webhook Journal client-credentials flow
- automatic mutation of HubSpot properties or association schema
- automatic upload, installation, or record-layout placement of `/hubspot-app`
- mobile app
- product analytics tooling

## 13. Success Criteria for the Current Build

The current build is coherent when:
- users can start scouting from active campaigns instead of free-floating runs
- the same run metadata powers Dashboard, CSV preparation, and HubSpot preparation
- admins can maintain reference data and data quality without schema or runtime hacks
- role-based permissions stay separate from `userType`-based business semantics
- outbound workflows remain auditable and batch-based
- direct HubSpot retries preserve stable portal-aware contact/deal identity and prior successes
- webhooks and reconciliation cannot bypass data precedence or delete on absence
