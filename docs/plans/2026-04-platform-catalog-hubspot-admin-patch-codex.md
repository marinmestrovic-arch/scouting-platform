# Codex Implementation Guide: Platform Catalog, HubSpot Sync, and Admin Cleanup Patch

- Status: Draft
- Date: 2026-04-22
- Owner: Marin / Ivan pair
- Branch: `plan/platform-catalog-hubspot-admin-patch`

---

## Goal

Turn the current platform from a Week 5/6 feature collection into a cleaner operating workspace:

- Dashboard has one handoff action: `Export`, which opens the current Google Sheets export flow.
- Catalog becomes a real creator database with useful filters, video/shorts median views, fixed social links, and profile details matching the table.
- Influencer profile pages show all catalog facts and no longer expose HypeAuditor advanced report actions.
- Database keeps Clients and Campaigns synced from active HubSpot custom objects.
- Admin is reduced to the admin-only workflows that still matter: users and CSV imports. Approvals, Exports, and HubSpot are removed from Admin.
- Admin CSV imports use the same Creator List / HubSpot handoff columns as the Google Sheets export and `docs/HubSpot_Import.gs`.

This is a multi-run patch. Do not try to land it as one giant PR unless the code remains easy to review. The safest delivery shape is 5 implementation runs plus a final QA run.

---

## Important Constraints

Follow `docs/AGENTS.md` and `CODEX_QUICKREF.md`.

- Provider calls stay in `backend/packages/integrations`.
- Domain logic stays in `backend/packages/core`.
- Route handlers enforce server-side auth and audit privileged mutations.
- Schema changes use Prisma migrations only.
- Background sync jobs need durable status, timestamps, and `lastError`.
- ADR-002 precedence remains unchanged:
  1. `admin_manual`
  2. `csv_import`
  3. `hypeauditor`
  4. `llm`
  5. `heuristics`
  6. `youtube_raw`
- "Remove approvals" must mean "remove the Hype advanced report product surface" in this patch. It must not become a bypass that executes HypeAuditor without approval.
- If any HypeAuditor advanced report execution remains reachable, approval gating must remain intact.
- `docs/HubSpot_Import.gs` is currently an untracked reference file and contains hard-coded provider keys. Treat it as reference-only unless secrets are redacted before committing.

---

## Current Code Map

Dashboard:

- `frontend/web/components/dashboard/dashboard-workspace.tsx`
  - Current row actions show `Export` linking to `getCsvPreviewHref(run.id)`.
  - Current row actions show `Google Sheets` linking to `getHubspotPreviewHref(run.id)`.
- `frontend/web/lib/navigation.ts`
  - Owns `getCsvPreviewHref` and `getHubspotPreviewHref`.
- Tests:
  - `frontend/web/components/dashboard/dashboard-workspace.test.ts`
  - `frontend/web/app/(authenticated)/dashboard/page.test.ts`

Catalog list and profile:

- `shared/packages/contracts/src/channels.ts`
  - `catalogChannelFiltersSchema` currently supports only `query`, `enrichmentStatus`, and `advancedReportStatus`.
  - `channelSummarySchema` and `channelDetailSchema` currently expose only a subset of catalog facts.
- `frontend/web/lib/catalog-filters.ts`
  - URL parsing, saved segment filter serialization, and labels are still built around enrichment/report statuses.
- `backend/packages/core/src/channels/repository.ts`
  - Current list filters use resolved enrichment and advanced report status SQL.
  - `toChannelSummary()` sets `socialMediaLink: channel.youtubeUrl`, which is correct only when `youtubeUrl` is populated.
  - Current selects expose `youtubeEngagementRate` and `youtubeFollowers`, but not video/shorts medians.
- `frontend/web/components/catalog/catalog-table-shell.tsx`
  - Table filter UI and saved segments are status-centric.
  - Table already has selected export/push actions and batch polling.
- `frontend/web/components/catalog/channel-detail-shell.tsx`
  - Profile page mixes creator identity, enrichment, and advanced report context.
  - It renders advanced report status/action controls and HypeAuditor insight sections.
- `frontend/web/components/catalog/admin-channel-manual-edit-panel.tsx`
  - Manual edit currently supports only title, handle, description, thumbnail.

Enrichment and metrics:

- `backend/packages/core/src/enrichment/metrics.ts`
  - Already computes `medianVideoViews`, `medianShortsViews`, and `medianVideoEngagementRate`.
- `backend/packages/core/src/enrichment/index.ts`
  - Persists `subscriberCount`, `viewCount`, `videoCount`, `youtubeEngagementRate`, and `youtubeFollowers` to `ChannelMetric`.
  - Does not persist video/shorts medians yet.
- `backend/packages/db/prisma/schema.prisma`
  - `ChannelMetric` lacks `youtubeVideoMedianViews` and `youtubeShortsMedianViews`.
- `backend/packages/core/src/export-previews.ts`
  - Already derives `youtubeVideoMedianViews` and `youtubeShortsMedianViews` from YouTube context for preview/Google Sheets export.
- `backend/packages/core/src/google-sheets-export.ts`
  - Already maps `YouTube Video Median Views` and `YouTube Shorts Median Views` into the Google Sheets export.

Admin:

- `frontend/web/components/admin/admin-workspace.tsx`
  - Tabs: Approvals, CSV Imports, Users, Exports, HubSpot.
- `frontend/web/components/admin/admin-dashboard-shell.tsx`
  - Shortcut cards still advertise Hype approvals, CSV exports, and HubSpot pushes.
- `frontend/web/app/(authenticated)/admin/page.tsx`
  - Page description mentions approvals.
- Advanced report UI/API/backend surfaces:
  - `frontend/web/components/admin/admin-advanced-report-queue.tsx`
  - `frontend/web/app/api/admin/advanced-report-requests/**`
  - `frontend/web/app/api/channels/[id]/advanced-report-requests/route.ts`
  - `backend/packages/core/src/approvals/**`
  - `backend/worker/src/channels-enrich-hypeauditor-worker.ts`

CSV import:

- `shared/packages/contracts/src/csv-imports.ts`
  - Strict header is camelCase and catalog-oriented:
    `youtubeChannelId, channelTitle, contactEmail, firstName, lastName, subscriberCount, viewCount, videoCount, notes, sourceLabel, influencerType, influencerVertical, countryRegion, language`.
- `backend/packages/core/src/imports/index.ts`
  - Parser expects the strict header exactly.
  - Import writes channel identity, contact, basic metrics, and HubSpot dropdown profile fields.
- `frontend/web/components/admin/admin-csv-import-manager.tsx`
  - Shows the current strict header template.
- `docs/HubSpot_Import.gs`
  - Reference Creator List / HubSpot handoff columns include human-readable headers such as:
    `Channel Name`, `HubSpot Record ID`, `Timestamp Imported`, `Channel URL`, `Campaign Name`, `Deal owner`, `Status`, `Email`, `Phone Number`, `Currency`, `Deal Type`, `Contact Type`, `Month`, `Year`, `Client name`, `Deal name`, `Activation Name`, `Pipeline`, `Deal stage`, `First Name`, `Last Name`, `Influencer Type`, `Influencer Vertical`, `Country/Region`, `Language`, `YouTube Handle`, `YouTube URL`, `YouTube Average Views`, `YouTube Video Median Views`, `YouTube Shorts Median Views`, `YouTube Engagement Rate`, `YouTube Followers`.

Database and HubSpot:

- `backend/packages/db/prisma/schema.prisma`
  - `Client` has local fields: `name`, `domain`, `countryRegion`, `city`.
  - `Campaign` has local fields: `name`, `clientId`, `marketId`, `briefLink`, `month`, `year`, `isActive`.
  - Neither model stores HubSpot object IDs or sync metadata.
- `backend/packages/core/src/campaigns.ts`
  - Local CRUD and permissions for clients/campaigns.
- `frontend/web/components/database/clients-workspace.tsx`
  - Local client list/create UI.
- `frontend/web/components/campaigns/campaigns-workspace.tsx`
  - Local campaign list/create UI.
- Existing HubSpot integration helpers:
  - `backend/packages/integrations/src/hubspot/contacts.ts`
  - `backend/packages/integrations/src/hubspot/properties.ts`

---

## Delivery Overview

| Run | Scope | Schema change? | Main risk |
| --- | --- | --- | --- |
| 1 | Dashboard and Admin surface cleanup | No | Accidentally hiding, rather than removing, dead workflows |
| 2 | Catalog metric model, social URL, and real filters | Yes | Filter performance and saved segment compatibility |
| 3 | Influencer profile view and enrichment fixes | Maybe | Losing useful enrichment visibility while removing Hype report UI |
| 4 | CSV import schema alignment with Creator List / HubSpot export | Yes | Importing existing files after header change |
| 5 | HubSpot Clients/Campaigns custom object sync | Yes | HubSpot object mapping ambiguity and job durability |
| 6 | End-to-end QA, cleanup, and docs | No | Old tests expecting removed surfaces |

---

## Run 1: Dashboard and Admin Surface Cleanup

### Outcome

The visible UI reflects the new product direction without changing backend behavior yet.

Dashboard:

- Remove the current CSV `Export` action from the dashboard row.
- Rename the current `Google Sheets` action to `Export`.
- The remaining `Export` action should link to `getHubspotPreviewHref(run.id)` because that is the Google Sheets export preparation flow.

Admin:

- Remove the `Approvals`, `Exports`, and `HubSpot` tabs from `AdminWorkspace`.
- Keep `CSV Imports` and `Users`.
- Default `/admin` to CSV Imports or Users. Recommended: CSV Imports, because it is the most active admin workflow after this patch.
- Update admin page copy so it does not mention approvals.
- Update admin dashboard shortcuts/copy if `AdminDashboardShell` remains linked anywhere.

### Tasks

1. Dashboard action cleanup.
   - File: `frontend/web/components/dashboard/dashboard-workspace.tsx`
   - Remove `getCsvPreviewHref` import if unused.
   - In row actions, delete the CSV export `<Link>`.
   - Change the Google Sheets link label from `Google Sheets` to `Export`.
   - Keep `target="_blank"` behavior only if it is still desired for export prep.

2. Dashboard tests.
   - Update assertions in:
     - `frontend/web/components/dashboard/dashboard-workspace.test.ts`
     - `frontend/web/app/(authenticated)/dashboard/page.test.ts`
   - Assert there is no visible `Google Sheets` label.
   - Assert each row still has an `Export` action pointing to the Google Sheets prep href.

3. Admin tab cleanup.
   - File: `frontend/web/components/admin/admin-workspace.tsx`
   - Change `AdminWorkspaceTab` to `"imports" | "users"`.
   - Remove dynamic import of `AdminAdvancedReportQueue`.
   - Remove placeholder panels for exports and HubSpot.
   - Remove tab handling for `approvals`, `exports`, and `hubspot`.
   - Handle old URLs gracefully:
     - `/admin?tab=approvals`, `/admin?tab=exports`, and `/admin?tab=hubspot` should fall back to imports.

4. Admin page and dashboard copy.
   - File: `frontend/web/app/(authenticated)/admin/page.tsx`
   - Replace "Review approvals, manage users..." with CSV imports/users wording.
   - File: `frontend/web/components/admin/admin-dashboard-shell.tsx`
   - Remove shortcut entries for HypeAuditor approvals, CSV exports, and HubSpot pushes.
   - Remove copy claiming "export and HubSpot workflows" are admin workflows.
   - If approval counts remain in `AdminDashboardResponse`, leave backend cleanup to Run 3 or Run 6, but do not show those counts.

5. Tests.
   - Update:
     - `frontend/web/components/admin/admin-workspace.test.tsx`
     - `frontend/web/components/admin/admin-dashboard-shell.test.ts`
     - `frontend/web/app/(authenticated)/admin/page.test.ts`
   - Remove assertions for `/exports`, `/hubspot`, and approval queue visibility.

### Acceptance Checks

- Dashboard row has exactly one handoff action named `Export`.
- Admin tabs show only CSV Imports and Users.
- Old admin tab URLs do not crash.
- No user-visible admin copy mentions approvals, HypeAuditor, Exports, or HubSpot.

---

## Run 2: Catalog Metric Model, Social URL, and Real Filters

### Outcome

Catalog becomes filterable by actual creator facts and displays YouTube long-form and Shorts median views.

### Data Model

Add fields to `ChannelMetric`:

- `youtubeVideoMedianViews BigInt? @map("youtube_video_median_views")`
- `youtubeShortsMedianViews BigInt? @map("youtube_shorts_median_views")`

Recommended indexes:

- `@@index([youtubeVideoMedianViews], map: "channel_metrics_youtube_video_median_views_idx")`
- `@@index([youtubeShortsMedianViews], map: "channel_metrics_youtube_shorts_median_views_idx")`

Consider indexes for common filters already on `channels`:

- `countryRegion`
- `influencerVertical`
- `influencerType`

If adding indexes, use a Prisma migration. Do not add runtime DDL.

### Filter Design

Replace the list UI filters for Enrichment Status and Report Status with practical catalog filters:

- Search query
- Country/Region
- Influencer Vertical
- Influencer Type
- YouTube Video Median Views minimum
- YouTube Video Median Views maximum
- YouTube Shorts Median Views minimum
- YouTube Shorts Median Views maximum
- YouTube Followers minimum
- YouTube Followers maximum
- Optional: Email present

Do not remove enrichment status fields from backend contracts in the same edit unless needed. For backward compatibility, keep parsing old saved segment filters but stop exposing them in new UI.

### Tasks

1. Prisma migration.
   - File: `backend/packages/db/prisma/schema.prisma`
   - Add median fields and indexes to `ChannelMetric`.
   - Generate migration with deterministic Prisma output.

2. Persist medians during enrichment.
   - File: `backend/packages/core/src/enrichment/index.ts`
   - `computeYoutubeMetrics` already returns `medianVideoViews` and `medianShortsViews` through `backend/packages/core/src/enrichment/metrics.ts`.
   - Include those values in `channelMetric.upsert({ create, update })`.
   - Preserve existing CSV/manual precedence expectations. If the median values are imported by CSV in Run 4, CSV should not be overwritten by lower-precedence automated enrichment unless the current code already treats CSV metrics as replaceable. If there is no source tracking per metric, document the limitation in the PR.

3. Extend contracts.
   - File: `shared/packages/contracts/src/channels.ts`
   - Add filter fields to `catalogChannelFiltersSchema`.
   - Add `youtubeVideoMedianViews` and `youtubeShortsMedianViews` to `channelSummarySchema` and `channelDetailSchema`.
   - Consider string output for BigInt metrics, matching `youtubeFollowers`.

4. Extend repository selects and mapping.
   - File: `backend/packages/core/src/channels/repository.ts`
   - Add median metric selects.
   - Add filter SQL/Prisma where conditions.
   - Replace status-specific raw SQL filtering with metric/profile filters where possible.
   - Keep ordering stable: newest channels first unless product asks otherwise.
   - Fix `socialMediaLink`:
     - Prefer `channel.youtubeUrl`.
     - Fallback to `https://www.youtube.com/channel/${youtubeChannelId}`.
     - If handle exists but `youtubeUrl` does not, prefer a canonical handle URL only if the handle is normalized and starts with `@`.

5. Update catalog filter state and URL parsing.
   - File: `frontend/web/lib/catalog-filters.ts`
   - Replace `enrichmentStatus` and `advancedReportStatus` UI state with real filters.
   - Keep backward-compatible readers for saved segments/URLs containing old status keys, but do not write those keys from new UI.
   - Use stable query params such as:
     - `countryRegion`
     - `influencerVertical`
     - `influencerType`
     - `youtubeVideoMedianViewsMin`
     - `youtubeVideoMedianViewsMax`
     - `youtubeShortsMedianViewsMin`
     - `youtubeShortsMedianViewsMax`
     - `youtubeFollowersMin`
     - `youtubeFollowersMax`
   - Add normalization helpers for numeric filter values.

6. Update catalog table UI.
   - File: `frontend/web/components/catalog/catalog-table-shell.tsx`
   - Replace status filter controls with searchable/select filters for country, vertical, type and numeric inputs for medians/followers.
   - Add table columns:
     - YouTube Video Median Views
     - YouTube Shorts Median Views
   - Keep row selection and selected export behavior.
   - Update empty-state copy to reference filters, not enrichment/report status.

7. Tests.
   - Update contract tests for channel filters.
   - Update repository tests or integration tests for numeric/country filters.
   - Update catalog behavior tests for URL parsing, saved segment loading, and applying filters.
   - Add enrichment persistence test for video/shorts medians.

### Acceptance Checks

- Catalog no longer presents Enrichment Status or Report Status filters.
- Filtering by country/region and median view thresholds works.
- Catalog table shows video and Shorts median views.
- Social Media Link is always a channel URL when enough YouTube identity exists.
- Old saved segments with status fields do not crash the UI.

### Run 2 Implementation Note

`ChannelMetric` still has no per-field source tracking. Run 2 persists YouTube video and Shorts medians from automated YouTube enrichment and Creator List preview refreshes, so those writers can overwrite existing median metric values. Preserving source precedence for imported medians requires adding metric source metadata in a later run.

---

## Run 3: Influencer Profile View and Hype Advanced Report Removal

### Outcome

The `/catalog/[channelId]` page becomes the influencer profile page and shows all catalog table fields. Hype advanced report controls are removed from the user journey.

### Profile Fields To Show

Everything visible or filterable in the Catalog table should also be visible on the profile page:

- Channel name/title
- YouTube channel ID
- YouTube handle
- YouTube URL
- Social media URL
- Platforms
- Country/Region
- Email
- Influencer Type
- Influencer Vertical
- Content language
- YouTube Followers
- YouTube Engagement Rate
- YouTube Video Median Views
- YouTube Shorts Median Views
- Thumbnail
- Description
- Enrichment status and useful enrichment summary, if still relevant

Do not prioritize HypeAuditor audience/commercial fields. The user's explicit priority is "features from the Catalog table".

### Tasks

1. Extend detail contract if Run 2 did not cover every field.
   - File: `shared/packages/contracts/src/channels.ts`
   - Add missing table/profile fields.
   - Keep values nullable rather than inventing placeholders in API output.

2. Extend detail repository mapping.
   - File: `backend/packages/core/src/channels/repository.ts`
   - Ensure detail select has the same core fields as list select.
   - Include `contentLanguage`.
   - Include medians from `ChannelMetric`.
   - Include social URL fallback.

3. Redesign the profile view.
   - File: `frontend/web/components/catalog/channel-detail-shell.tsx`
   - Replace the current "advanced report context" profile block with catalog facts and metrics.
   - Add a clear Social media URL row linking to the channel.
   - Show metrics in a compact facts grid.
   - Keep enrichment action/status only if "Fix enrichment" still requires manual refresh visibility.
   - Remove visible HypeAuditor advanced report action/status controls.
   - Remove copy that says HypeAuditor-derived insights are part of the review flow.

4. Disable or remove Hype advanced report entry points.
   - Remove the `StatusPopoverTag` for advanced reports from `channel-detail-shell.tsx`.
   - Remove `onRequestAdvancedReport` plumbing if no longer used.
   - Remove client API calls to `/api/channels/[id]/advanced-report-requests`.
   - Keep backend approval/Hype code temporarily if removing it creates too much blast radius in this run. It can be retired in Run 6 after UI and tests pass.

5. Fix enrichment gaps.
   - Confirm enrichment writes:
     - `handle`
     - `youtubeUrl`
     - `countryRegion`
     - `contentLanguage`
     - `influencerType`
     - `influencerVertical`
     - YouTube medians through Run 2 metrics persistence
   - Files likely involved:
     - `backend/packages/core/src/enrichment/index.ts`
     - `backend/packages/integrations/src/youtube/context.ts`
     - `backend/packages/integrations/src/openai/channel-enrichment.ts`
   - If OpenAI output does not support influencer type/vertical/country reliably, prefer deterministic CSV/HubSpot dropdown sources and explicit manual edits over adding speculative prompt output.

6. Manual edit expansion, if needed.
   - Current manual overrides only cover title, handle, description, thumbnail.
   - If product expects profile corrections from UI, extend manual overrides for:
     - `youtubeUrl`
     - `countryRegion`
     - `contentLanguage`
     - `influencerType`
     - `influencerVertical`
   - This requires schema enum changes and audit coverage.
   - Do this only if there is enough time in Run 3; otherwise make it a follow-up plan.

7. Tests.
   - Update:
     - `frontend/web/components/catalog/channel-detail-shell.test.ts`
     - `frontend/web/components/catalog/channel-detail-shell.behavior.test.ts`
   - Remove tests expecting advanced report action UI.
   - Add tests asserting social URL and all Catalog table fields render.
   - Add backend detail contract/repository tests for medians and social URL fallback.

### Acceptance Checks

- Influencer profile page displays every priority catalog field.
- Social media URL is present and links to the YouTube channel.
- No Hype advanced report request button/status appears on the profile page.
- Enrichment still works for core profile data and visible errors remain understandable.

---

## Run 4: CSV Import Columns Aligned With Creator List / HubSpot Import

### Outcome

Admin CSV import accepts the same human-readable Creator List columns used by Google Sheets export and `docs/HubSpot_Import.gs`, instead of the old camelCase strict template.

### Recommended Approach

Do not directly couple admin import parsing to Google Apps Script. Create a shared TypeScript column definition for the Creator List / HubSpot handoff schema and use it in:

- Google Sheets export alignment
- Admin CSV import header validation
- Admin CSV import UI template display
- Tests

Possible location:

- `shared/packages/contracts/src/creator-list.ts`
- Or `shared/packages/contracts/src/hubspot-creator-list.ts`

### Target Header

Use the Creator List headers from `docs/HubSpot_Import.gs` and current Google Sheets export resolvers:

1. `Channel Name`
2. `HubSpot Record ID`
3. `Timestamp Imported`
4. `Channel URL`
5. `Campaign Name`
6. `Deal owner`
7. `Status`
8. `Email`
9. `Phone Number`
10. `Currency`
11. `Deal Type`
12. `Contact Type`
13. `Month`
14. `Year`
15. `Client name`
16. `Deal name`
17. `Activation Name`
18. `Pipeline`
19. `Deal stage`
20. `First Name`
21. `Last Name`
22. `Influencer Type`
23. `Influencer Vertical`
24. `Country/Region`
25. `Language`
26. `YouTube Handle`
27. `YouTube URL`
28. `YouTube Average Views`
29. `YouTube Video Median Views`
30. `YouTube Shorts Median Views`
31. `YouTube Engagement Rate`
32. `YouTube Followers`

Before implementation, compare this list with the live sheet template and `GOOGLE_SHEETS_HEADER_RESOLVERS` in `backend/packages/core/src/google-sheets-export.ts`. If the live template has extra active columns, add them to the shared schema as nullable/ignored fields.

### Mapping Notes

- `Channel Name` maps to `Channel.title`.
- `Channel URL`, `YouTube URL`, and `YouTube Handle` can all identify the YouTube channel.
- If `youtubeChannelId` is not supplied as a column, derive it from URL/handle only when the platform already has a resolver. Do not add browser/provider calls. Server-side YouTube resolution belongs in integrations/core/worker.
- `Email`, `First Name`, `Last Name`, and `Phone Number` map to contact data. Current `ChannelContact` does not have phone number, so either:
  - add `phoneNumber` to `ChannelContact`, or
  - keep phone only in import row payload until a contact model change is approved.
- `YouTube Followers` maps to `ChannelMetric.youtubeFollowers` and probably `subscriberCount`.
- `YouTube Average Views` maps to existing average metric only if the schema has it. Current schema does not show a persisted average views field, so either add it or treat it as legacy input.
- `YouTube Video Median Views` and `YouTube Shorts Median Views` map to the new fields from Run 2.
- Dropdown fields must validate against saved HubSpot dropdown values:
  - `Influencer Type`
  - `Influencer Vertical`
  - `Country/Region`
  - `Language`
  - Also consider `Currency`, `Deal Type`, `Activation Type` if those columns are retained.

### Tasks

1. Shared schema.
   - Add a shared constant for Creator List CSV headers.
   - Export normalized header helpers.
   - Add tests for exact header order and normalization.

2. Contract update.
   - File: `shared/packages/contracts/src/csv-imports.ts`
   - Replace or version `CSV_IMPORT_HEADER`.
   - Bump `CSV_IMPORT_TEMPLATE_VERSION` from `v2` to `v3`.
   - Add new row fields to `csvImportRowSchema` only for values shown in the import detail UI.

3. Schema update.
   - File: `backend/packages/db/prisma/schema.prisma`
   - Add new `CsvImportRow` columns needed for audit/detail:
     - `channelUrl`
     - `campaignName`
     - `phoneNumber`
     - `currency`
     - `dealType`
     - `contactType`
     - `month`
     - `year`
     - `clientName`
     - `dealName`
     - `activationName`
     - `pipeline`
     - `dealStage`
     - `youtubeHandle`
     - `youtubeUrl`
     - `youtubeAverageViews`
     - `youtubeVideoMedianViews`
     - `youtubeShortsMedianViews`
     - `youtubeEngagementRate`
     - `youtubeFollowers`
   - Keep fields nullable.
   - Avoid destructive changes to old columns until migration/backfill is decided.

4. Parser update.
   - File: `backend/packages/core/src/imports/index.ts`
   - Update header validation to the new human-readable header.
   - Map by header name, not by magic index, to make future column additions safer.
   - Preserve row-level error reporting.
   - Store the original input values on `CsvImportRow`.
   - For imported rows, update:
     - `Channel`
     - `ChannelContact`
     - `ChannelMetric`
   - Use precedence-safe behavior for profile fields. CSV import should not overwrite admin manual overrides.

5. UI update.
   - File: `frontend/web/components/admin/admin-csv-import-manager.tsx`
   - Show the new header line.
   - Update explanatory copy: "Use the Creator List / HubSpot export CSV format."
   - Update row detail table to display the most useful imported fields.

6. Tests.
   - Update:
     - `shared/packages/contracts/src/csv-imports.test.ts`
     - `backend/packages/core/src/week5-csv-import.integration.test.ts`
     - `frontend/web/app/api/week5-csv-import.integration.test.ts`
     - `frontend/web/components/admin/admin-csv-import-manager.test.tsx`
     - `frontend/web/e2e/authenticated.spec.ts`

### Acceptance Checks

- A CSV exported from the Google Sheets / Creator List flow can be uploaded into Admin CSV Imports without header mismatch.
- Row failures name human-readable columns.
- Imported medians appear in Catalog after processing.
- Admin manual overrides remain higher precedence than CSV import.

---

## Run 5: HubSpot Clients and Campaigns Sync

### Outcome

Database Clients and Campaigns are synced from active HubSpot custom objects. Local database views become a read/write local cache of HubSpot-backed records instead of purely local records.

### Open Questions To Resolve Before Coding

HubSpot custom object type IDs and property names are portal-specific. Confirm these from HubSpot before implementation:

- Client custom object type ID or fully qualified object type.
- Campaign custom object type ID or fully qualified object type.
- Property names for:
  - Client name
  - Client domain
  - Client country/region
  - Client city
  - Client active flag, if present
  - Campaign name
  - Campaign client association or client object ID
  - Campaign market/country
  - Campaign brief link
  - Campaign month
  - Campaign year
  - Campaign active flag or lifecycle state

If the API cannot reliably discover these by label, add explicit env vars. Recommended:

- `HUBSPOT_CLIENT_OBJECT_TYPE`
- `HUBSPOT_CAMPAIGN_OBJECT_TYPE`
- `HUBSPOT_CLIENT_NAME_PROPERTY`
- `HUBSPOT_CAMPAIGN_NAME_PROPERTY`
- Additional property env vars as needed.

### Data Model

Add sync metadata:

Client:

- `hubspotObjectId String? @map("hubspot_object_id")`
- `hubspotObjectType String? @map("hubspot_object_type")`
- `hubspotArchived Boolean @default(false) @map("hubspot_archived")`
- `hubspotSyncedAt DateTime? @map("hubspot_synced_at")`
- `hubspotRawPayload Json? @map("hubspot_raw_payload")`
- `isActive Boolean @default(true) @map("is_active")`

Campaign:

- `hubspotObjectId String? @map("hubspot_object_id")`
- `hubspotObjectType String? @map("hubspot_object_type")`
- `hubspotArchived Boolean @default(false) @map("hubspot_archived")`
- `hubspotSyncedAt DateTime? @map("hubspot_synced_at")`
- `hubspotRawPayload Json? @map("hubspot_raw_payload")`

Sync run:

- New model, suggested name: `HubspotObjectSyncRun`
- Fields:
  - `id`
  - `requestedByUserId`
  - `status` queued/running/completed/failed
  - `objectTypes` JSON or enum list
  - `clientUpsertCount`
  - `campaignUpsertCount`
  - `deactivatedCount`
  - `startedAt`
  - `completedAt`
  - `lastError`
  - `createdAt`
  - `updatedAt`

This satisfies job durability for the sync workflow.

### Integration Layer

Add provider adapter functions under `backend/packages/integrations/src/hubspot/`.

Suggested file:

- `backend/packages/integrations/src/hubspot/custom-objects.ts`

Functions:

- `fetchHubspotObjectSchemas()`
- `fetchHubspotCustomObjects({ objectType, properties, archived, after })`
- `fetchHubspotAssociations({ fromObjectType, toObjectType, objectIds })` if campaign-client relation uses associations

Requirements:

- Use server-side `HUBSPOT_API_KEY`.
- Normalize HubSpot API errors the same way existing contact/property adapters do.
- Unit test with mocked `fetch`.

### Core Sync Service

Add domain sync under `backend/packages/core/src/hubspot/`.

Suggested file:

- `backend/packages/core/src/hubspot/object-sync.ts`

Responsibilities:

- Discover or read configured custom object types.
- Fetch active HubSpot Client objects.
- Fetch active HubSpot Campaign objects.
- Upsert local `Client` rows by `hubspotObjectId` first, then by normalized name if needed.
- Upsert local `Campaign` rows by `hubspotObjectId` first, then by unique local key if needed.
- Create missing `Market` reference rows if HubSpot campaign markets are valid but missing locally.
- Mark local HubSpot-sourced records inactive/archived when HubSpot returns archived or inactive objects.
- Do not delete local rows.
- Emit audit event for manual sync trigger.

### Worker and API

1. Contract.
   - Add sync run schemas under `shared/packages/contracts/src/hubspot-sync.ts` or `campaigns.ts`.

2. Queue.
   - Add job payload to `shared/packages/contracts/src/jobs.ts`.
   - Add queue helper in core.
   - Register worker in `backend/worker/src/index.ts`.
   - Add worker file and tests.

3. API.
   - Add admin-only route:
     - `frontend/web/app/api/database/hubspot-sync/route.ts`
   - POST starts a durable sync run and enqueues the worker.
   - GET can list recent sync runs or return latest run.
   - Server-side auth required.
   - Audit sync trigger.

4. UI.
   - File: `frontend/web/components/database/database-admin-workspace.tsx`
   - Add sync status/action near Clients and Campaigns, not Admin.
   - Show:
     - last sync status
     - counts
     - last error
     - "Sync from HubSpot" button for admins
   - Update `clients-workspace.tsx` and `campaigns-workspace.tsx` to show HubSpot sync metadata subtly.

### Acceptance Checks

- Admin can trigger Clients/Campaigns sync from Database.
- Sync writes durable run status and `lastError`.
- Active HubSpot custom objects appear in local Clients and Campaigns.
- Archived/inactive HubSpot objects are not deleted locally but become inactive.
- No HubSpot provider call happens from browser code.

---

## Run 6: QA, Backend Retirement, and Documentation

### Outcome

Old removed surfaces are not just hidden; stale routes/tests/docs are reconciled or intentionally documented.

### Tasks

1. Retire Hype advanced report surface.
   - If no UI references remain, decide whether to:
     - keep backend code dormant for historical data reads, or
     - remove routes/worker registration/contracts.
   - If removing backend routes:
     - Delete or deprecate `frontend/web/app/api/admin/advanced-report-requests/**`.
     - Delete or deprecate `frontend/web/app/api/channels/[id]/advanced-report-requests/route.ts`.
     - Stop registering `channels.enrich.hypeauditor` worker if no job can be created.
   - Keep historical DB tables unless a separate data-retention decision is approved.

2. Clean navigation and docs.
   - Search for user-visible old labels:
     - `Google Sheets`
     - `HypeAuditor approvals`
     - `Advanced report`
     - `HubSpot pushes`
     - `CSV exports`
   - Keep only labels that still reflect a reachable flow.
   - Update setup/readiness docs if they still tell QA to approve Hype reports or inspect HubSpot push history.

3. End-to-end coverage.
   - Update `frontend/web/e2e/authenticated.spec.ts`:
     - Dashboard uses new `Export` action.
     - Admin CSV imports with new Creator List header.
     - Catalog filters by real profile/metric fields.
     - Database HubSpot sync can be mocked or smoke-tested if integration secrets are absent.

4. Test suite.
   - Run targeted tests first:
     - `pnpm --filter @scouting-platform/contracts test`
     - `pnpm --filter @scouting-platform/core test`
     - `pnpm --filter @scouting-platform/integrations test`
     - `pnpm --filter @scouting-platform/worker test`
     - `pnpm --filter @scouting-platform/web test`
   - Then run e2e if local environment supports it.

5. Manual smoke checklist.
   - Dashboard opens export prep from a run.
   - Catalog filters by Country/Region and median views.
   - Catalog profile renders social URL and medians.
   - Admin shows only CSV Imports and Users.
   - Admin CSV import accepts a Creator List CSV.
   - Database sync creates/updates Clients and Campaigns from HubSpot.

---

## Suggested PR Split

1. PR 1: Dashboard/Admin UI cleanup only.
2. PR 2: Catalog medians, social URL, filters.
3. PR 3: Profile page cleanup and Hype advanced report UI removal.
4. PR 4: CSV import schema v3.
5. PR 5: HubSpot custom object sync.
6. PR 6: Cleanup docs/tests/dead backend routes.

This split keeps schema-heavy work separate from UI copy cleanup and HubSpot integration work.

---

## Risks and Decisions

### HypeAuditor Approval Rule

Repo policy says HypeAuditor advanced reports require approval. This patch should remove advanced reports from the product. It should not add an unapproved execution path. If advanced report backend remains for history, make sure no new request path is reachable from UI.

### CSV Import Backward Compatibility

Changing the strict header from camelCase v2 to Creator List v3 will break old admin CSV templates. Options:

- Accept only v3 and document the break.
- Accept both v2 and v3 for one release.

Recommended: accept both v2 and v3 in parser, but show only v3 in the UI.

### HubSpot Custom Object Mapping

Do not guess custom object type IDs in code. Use env vars or schema discovery with explicit label checks. If multiple matching objects exist, fail the sync run with a clear `lastError`.

### Metric Source Tracking

`ChannelMetric` does not currently track source per metric. Persisting enrichment medians may overwrite CSV-imported medians after Run 4 unless guarded. If source-aware metric precedence is required, add source fields or a separate metric source model. Otherwise document current behavior clearly.

### Profile "All Features"

"All features from the Catalog table" means all columns and filterable fields, not every internal DB field. Avoid turning the profile into a raw schema dump.

---

## Definition of Done

- Dashboard has one row action named `Export`, backed by Google Sheets export prep.
- Catalog filters are real creator/metric filters, not enrichment/report status filters.
- Catalog table and profile both show YouTube Video Median Views and YouTube Shorts Median Views.
- Social media URL points to the channel.
- Influencer profile includes all priority catalog fields.
- Hype advanced report UI is gone.
- Admin no longer shows Approvals, Exports, or HubSpot.
- Admin CSV import accepts Creator List / HubSpot handoff columns.
- Database can sync active HubSpot Client and Campaign custom objects through server-side integration code and durable worker execution.
- Tests are updated for every changed contract, route, worker, and UI surface.
