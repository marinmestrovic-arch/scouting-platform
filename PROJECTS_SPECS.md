# Project Specs

Current product spec for the implemented repository state as of 2026-04-01.

## 1. Product Definition

`scouting-platform` is an internal creator scouting tool centered on active campaigns.

The current product combines:
- a shared creator catalog
- campaign and client reference data
- campaign-linked scouting runs
- automated enrichment plus approval-gated HypeAuditor reports
- admin-operated imports and manual overrides
- CSV export, HubSpot push, and HubSpot import-ready batch preparation

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
- HubSpot preparation, import-ready CSV history, and legacy push history

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
- HubSpot API key

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
- exposes admin-only dropdown reference values used by HubSpot preparation
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
- dropdown values used for HubSpot preparation defaults and row edits

Current Database workspace behavior:
- clients: list/create
- campaigns: list/create and active filtering
- dropdown values: admin-only list/replace

Campaign creation is available to:
- admins
- `campaign_lead` users
- `hoc` users

## 9. Export and HubSpot Surface

### CSV export
- users can create CSV export batches from selected creators or filtered catalog scopes
- exports are background-safe and downloadable by batch id
- CSV preparation pages show the full run-derived export table before download

### HubSpot push
- legacy manual push remains implemented for selected creators
- push batches persist per-row status and errors

### HubSpot import-ready preparation
- users can open a run-scoped HubSpot preparation page
- the app exposes required-field validation issues before batch creation
- shared dropdown defaults and per-row overrides can be edited before generating the import CSV
- completed import-ready batches can be reviewed and downloaded later

This means the current outbound surface is broader than "CSV export + HubSpot push." It also includes HubSpot import batch preparation from run snapshots.

## 10. API-Supported Product Surface

The UI currently depends on route families for:
- campaigns
- clients
- campaign-manager lookup
- dropdown values
- runs and run previews
- CSV export batches and downloads
- HubSpot push batches
- HubSpot import batches and downloads
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
- automatic HubSpot sync
- browser-direct provider integrations
- multi-tenant organizations
- mobile app
- product analytics tooling

## 13. Success Criteria for the Current Build

The current build is coherent when:
- users can start scouting from active campaigns instead of free-floating runs
- the same run metadata powers Dashboard, CSV preparation, and HubSpot preparation
- admins can maintain reference data and data quality without schema or runtime hacks
- role-based permissions stay separate from `userType`-based business semantics
- outbound workflows remain auditable and batch-based
